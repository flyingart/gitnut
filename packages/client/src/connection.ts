import {
  BASE_PROTOCOL,
  BEARER_PROTOCOL_PREFIX,
  DEFAULT_PORT,
  type ErrorCode,
  type HealthResponse,
  type EventName,
  type Events,
  type Method,
  type ParamsOf,
  type ResultOf,
  type ServerInfo,
  type Topic,
} from "@gitnut/commons";
import { Query } from "./query";

/** Where a daemon is. `token` is optional: same-origin web apps use the login cookie. */
export interface ServerConfig {
  /** Base URL, for example `http://my-box:7420`. */
  url: string;
  token?: string;
  /** Display name override (default: the daemon's name). */
  name?: string;
}

export type ConnectionState = "connecting" | "open" | "unauthorized" | "offline";

export class GitnutRpcError extends Error {
  constructor(
    readonly code: ErrorCode | "offline" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

export interface ConnectionOptions {
  /** WebSocket implementation (tests). */
  WebSocket?: typeof WebSocket;
  fetch?: FetchFn;
  /** Call timeout in ms (default 120 s). */
  timeoutMs?: number;
  /** First reconnect delay in ms, doubled up to 10 s. */
  backoffMs?: number;
}

interface Pending {
  method: string;
  params: unknown;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sent: boolean;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

/** What the user typed ("my-box", "my-box:7420", "https://host") as a daemon URL: http:// and port 7420 by default. */
export function parseServerAddress(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  const url = new URL(u);
  if (!url.port && url.protocol === "http:") url.port = String(DEFAULT_PORT);
  return normalizeUrl(url.origin + url.pathname);
}

/** Why a reachable daemon with auth off still refuses a page that isn't its own (see HealthResponse.originAllowed). */
export const NEEDS_TOKEN = "This daemon needs its access token: run `gitnut token` on that machine and paste it into the server settings.";

/** True when this page is served by the daemon at `url` (same origin). */
export const servesThisPage = (url: string) => typeof location !== "undefined" && normalizeUrl(location.origin) === normalizeUrl(url);

/** `GET /api/health` of a daemon, or null when it can't be reached or isn't a gitnut daemon. */
export async function fetchHealth(url: string, fetchFn: FetchFn = (u, i) => globalThis.fetch(u, i)): Promise<HealthResponse | null> {
  try {
    const h = (await (await fetchFn(`${normalizeUrl(url)}/api/health`)).json()) as HealthResponse;
    return h?.ok ? h : null;
  } catch {
    return null;
  }
}

/**
 * One WebSocket to one daemon: typed calls, events, auto-reconnect with backoff,
 * ref-counted topic subscriptions and a small shared query cache.
 */
export class GitnutConnection {
  readonly url: string;
  token: string | undefined;
  state: ConnectionState = "connecting";
  info: ServerInfo | null = null;
  /** Last connection problem, for display. */
  error: string | null = null;
  /** Increments on every state / info / token change (for useSyncExternalStore). */
  version = 0;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private topics = new Map<string, number>();
  private events = new Map<string, Set<(data: any) => void>>();
  private listeners = new Set<() => void>();
  private queries = new Map<string, Query<any>>();
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private everOpened = false;
  private WS: typeof WebSocket;
  private fetchFn: FetchFn;

  constructor(server: ServerConfig, private opts: ConnectionOptions = {}) {
    this.url = normalizeUrl(server.url);
    this.token = server.token || undefined;
    this.label = server.name || undefined;
    this.WS = opts.WebSocket ?? globalThis.WebSocket;
    this.fetchFn = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.on("repos.changed", (d) => this.queries.get("repos")?.set(d));
    this.on("settings.changed", (d) => {
      this.queries.get("settings")?.set(d);
      this.loadInfo();
    });
    this.on("update.available", (d) => this.queries.get("update")?.set(d));
    this.on("graph.changed", (d) => this.queries.get(`graph:${d.repoId}`)?.refetch());
    this.on("worktree.changed", (wt) => {
      this.queries.get(`status:${wt.id}`)?.refetch();
      const repos = this.queries.get("repos");
      if (repos?.data) {
        repos.set(
          (repos.data as Events["repos.changed"]).map((r) =>
            r.id !== wt.repoId ? r : { ...r, worktrees: r.worktrees.map((w) => (w.id === wt.id ? wt : w)) },
          ),
        );
      }
    });
    this.connect();
  }

  /** Same-origin connections rely on the HttpOnly login cookie instead of a token. */
  get usesCookie(): boolean {
    return !this.token && servesThisPage(this.url);
  }

  /** Name given by the user (ServerConfig.name); wins over the daemon's name. */
  label: string | undefined;

  get name(): string {
    return this.label ?? this.info?.name ?? this.url.replace(/^https?:\/\//, "");
  }

  private connect() {
    if (this.closed) return;
    this.setState("connecting");
    const wsUrl = this.url.replace(/^http/, "ws") + "/ws";
    const protocols = this.token ? [BASE_PROTOCOL, BEARER_PROTOCOL_PREFIX + this.token] : [BASE_PROTOCOL];
    let opened = false;
    let ws: WebSocket;
    try {
      ws = new this.WS(wsUrl, protocols);
    } catch (e) {
      this.error = String((e as Error).message ?? e);
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onopen = () => {
      opened = true;
      this.everOpened = true;
      this.retries = 0;
      this.error = null;
      this.setState("open");
      const topics = [...this.topics.keys()] as Topic[];
      if (topics.length) this.send("subscribe", { topics }).catch(() => {});
      for (const [id, p] of this.pending) if (!p.sent) this.transmit(id, p);
      this.loadInfo();
      for (const q of this.queries.values()) if (q.active && !q.loading) q.refetch();
    };
    ws.onmessage = (ev) => this.onMessage(String(ev.data));
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const [id, p] of this.pending) {
        if (!p.sent) continue;
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.reject(new GitnutRpcError("offline", "connection lost"));
      }
      if (this.closed) return;
      if (ev.code === 4001) return this.setUnauthorized("The access token changed. Log in again.");
      if (!opened) void this.probe();
      else this.scheduleRetry();
    };
  }

  private loadInfo() {
    this.call("server.info").then((info) => {
      this.info = info;
      this.emitChange();
    }, () => {});
  }

  /** The handshake was refused: offline, or auth required? */
  private async probe() {
    const h = await fetchHealth(this.url, this.fetchFn);
    if (h?.authRequired) return this.setUnauthorized(this.everOpened ? "Your session ended. Log in again." : null);
    this.error = !h ? "Can't reach the daemon" : h.originAllowed ? "The daemon refused the connection" : NEEDS_TOKEN;
    this.scheduleRetry();
  }

  private setUnauthorized(msg: string | null) {
    this.error = msg;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new GitnutRpcError("unauthorized", "unauthorized"));
    }
    this.setState("unauthorized");
  }

  private scheduleRetry() {
    if (this.closed) return;
    this.setState("offline");
    const delay = Math.min(10_000, (this.opts.backoffMs ?? 300) * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Reconnect now (after login or when the user presses retry). */
  reconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retries = 0;
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.connect();
  }

  /** Check a token and use it: sets the login cookie for same-origin use, else keeps the token. Throws on a wrong token. */
  async login(token: string) {
    token = token.trim();
    if (this.usesCookie || (!this.token && this.state === "unauthorized" && this.sameOrigin())) {
      const r = await this.fetchFn(this.url + "/api/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) throw new GitnutRpcError("unauthorized", "Wrong token");
    } else {
      const r = await this.fetchFn(this.url + "/api/rpc", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ method: "server.info", params: null }),
      });
      if (r.status === 401) throw new GitnutRpcError("unauthorized", "Wrong token");
      this.token = token;
    }
    this.reconnect();
    this.emitChange();
  }

  private sameOrigin() {
    return servesThisPage(this.url);
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Typed RPC call. Waits for the connection while it is (re)connecting. */
  call<M extends Method>(method: M, ...args: ParamsOf<M> extends void ? [] : [ParamsOf<M>]): Promise<ResultOf<M>> {
    return this.send(method, args[0]);
  }

  private send(method: string, params: unknown): Promise<any> {
    if (this.state === "unauthorized") return Promise.reject(new GitnutRpcError("unauthorized", "unauthorized"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GitnutRpcError("timeout", `${method} timed out`));
      }, this.opts.timeoutMs ?? 120_000);
      const p: Pending = { method, params, resolve, reject, timer, sent: false };
      this.pending.set(id, p);
      if (this.state === "open") this.transmit(id, p);
    });
  }

  private transmit(id: number, p: Pending) {
    p.sent = true;
    this.ws!.send(JSON.stringify({ id, method: p.method, params: p.params ?? null }));
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.event === "string") {
      for (const fn of this.events.get(msg.event) ?? []) fn(msg.data);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new GitnutRpcError(msg.error.code, msg.error.message));
    else p.resolve(msg.result);
  }

  on<E extends EventName>(event: E, fn: (data: Events[E]) => void): () => void {
    let set = this.events.get(event);
    if (!set) this.events.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Ref-counted subscription to a daemon topic. Returns the release function. */
  retain(topic: Topic): () => void {
    const n = this.topics.get(topic) ?? 0;
    this.topics.set(topic, n + 1);
    if (n === 0 && this.state === "open") this.send("subscribe", { topics: [topic] }).catch(() => {});
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const m = (this.topics.get(topic) ?? 1) - 1;
      if (m > 0) return void this.topics.set(topic, m);
      this.topics.delete(topic);
      if (this.state === "open") this.send("unsubscribe", { topics: [topic] }).catch(() => {});
    };
  }

  /** Topics with their reference counts (debugging, tests). */
  get subscriptions(): ReadonlyMap<string, number> {
    return this.topics;
  }

  /** Shared cached query: same key = same data for every component on this connection. */
  query<T>(key: string, fetcher: () => Promise<T>, topic?: Topic): Query<T> {
    let q = this.queries.get(key);
    if (!q) {
      q = new Query<T>(fetcher, topic ? () => this.retain(topic) : null);
      this.queries.set(key, q);
    }
    return q;
  }

  /** Listen to state, info and token changes. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: ConnectionState) {
    if (this.state === s) return;
    this.state = s;
    this.emitChange();
  }

  private emitChange() {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }
}

const shared = new Map<string, GitnutConnection>();

/** Shared connection per server URL (components with a `server` prop and no provider). */
export function getConnection(server: ServerConfig, opts?: ConnectionOptions): GitnutConnection {
  const url = normalizeUrl(server.url);
  let c = shared.get(url);
  if (!c) shared.set(url, (c = new GitnutConnection(server, opts)));
  else c.label = server.name || undefined;
  if (server.token && server.token !== c.token) {
    c.token = server.token;
    c.reconnect();
  }
  return c;
}

/** Close and forget a shared connection. */
export function dropConnection(url: string) {
  const key = normalizeUrl(url);
  shared.get(key)?.close();
  shared.delete(key);
}
