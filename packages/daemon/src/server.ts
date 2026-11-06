import { hostname } from "node:os";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import {
  BASE_PROTOCOL,
  RESTART_KEYS,
  BEARER_PROTOCOL_PREFIX,
  PROTOCOL_VERSION,
  isPublicBind,
  toPublicSettings,
  type Settings,
  type SettingsPatch,
  type UpdateInfo,
} from "@gitnut/commons";
import { fetchAll } from "./actions";
import { applyPatch, homeDir, loadConfig, saveConfig, type Config } from "./config";
import { GitnutError, fail } from "./errors";
import { GraphCache } from "./graph";
import { Live, eventMessage } from "./live";
import { authCookie, authorize, isHttps, tokenEquals } from "./auth";
import { localHost, resolveBind, urlHost } from "./net";
import { RepoIndex } from "./repos";
import { dispatch } from "./rpc";
import { checkUpdate, cleanupOldBinary, restartProcess } from "./update";
import { VERSION } from "./version";
import { loadWebAssets, serveWeb } from "./web";

export interface SocketData {
  token: string | null;
}
export type Socket = ServerWebSocket<SocketData>;

export type Overrides = Partial<Pick<Settings, "port" | "bind" | "serveWeb">>;

export interface DaemonOptions {
  home?: string;
  /** CLI flags: override settings for this run only. */
  overrides?: Overrides;
  /** Allow auth off on a public bind. */
  force?: boolean;
  /** Called after update.apply installed a new binary. Default: restart the process. */
  restart?: () => void;
  log?: (msg: string) => void;
}

const UPDATE_EVERY = 6 * 3600_000;

/** Runtime info for the CLI (`gitnut status`, `gitnut stop`). */
export interface DaemonFile {
  pid: number;
  url: string;
  listen: string;
  version: string;
}
export const daemonFile = (home: string) => join(home, "daemon.json");

export class Daemon {
  readonly home: string;
  cfg: Config;
  overrides: Overrides;
  index: RepoIndex;
  graphs = new GraphCache(() => this.settings.hideInternalRefs !== false);
  live: Live;
  server: Server<SocketData> | null = null;
  sockets = new Set<Socket>();
  listenHost = "";
  update: UpdateInfo | null = null;
  private web: Awaited<ReturnType<typeof loadWebAssets>> = { dir: null, embedded: null };
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private autoFetch: { timer: ReturnType<typeof setTimeout> | null; running: boolean } = { timer: null, running: false };
  /** Completed auto-fetch rounds (for tests and `gitnut status`). */
  autoFetchRuns = 0;
  private log: (msg: string) => void;
  private resolveStopped!: () => void;
  /** Resolves when the daemon stopped (`gitnut stop`, /api/stop). */
  readonly stopped = new Promise<void>((r) => (this.resolveStopped = r));

  constructor(private opts: DaemonOptions = {}) {
    this.home = homeDir(opts.home);
    this.cfg = loadConfig(this.home);
    this.overrides = { ...opts.overrides };
    this.index = new RepoIndex(() => this.settings);
    this.live = new Live(this.index, this.graphs);
    this.log = opts.log ?? ((m) => console.log(m));
  }

  /** Persisted settings with this run's CLI overrides applied. */
  get settings(): Settings {
    return { ...this.cfg.settings, ...this.overrides };
  }

  get name() {
    return this.settings.name || hostname();
  }

  get port() {
    return this.server?.port ?? 0;
  }

  get listen() {
    return `${urlHost(this.listenHost)}:${this.port}`;
  }

  /** URL a client on this machine can open. */
  get url() {
    return `http://${urlHost(localHost(this.listenHost))}:${this.port}`;
  }

  async start() {
    const s = this.settings;
    if (!s.auth.enabled && isPublicBind(s.bind) && !this.opts.force) {
      fail("bad_request", `auth is off on the public bind "${s.bind}". Pass --force to allow it.`);
    }
    cleanupOldBinary();
    this.web = await loadWebAssets();
    await this.listenWithRetry();
    this.live.start(s.pollIntervalMs);
    void this.index.refresh().catch(() => {});
    this.scheduleUpdateChecks();
    this.scheduleAutoFetch();
    this.log(`gitnut ${VERSION} listening on ${this.listen} (${this.url})`);
  }

  async stop() {
    this.live.stop();
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.server?.stop(true);
    this.server = null;
    this.scheduleAutoFetch();
    this.sockets.clear();
    rmSync(daemonFile(this.home), { force: true });
    this.resolveStopped();
  }

  private listenOnce() {
    const s = this.settings;
    this.listenHost = resolveBind(s.bind);
    this.server = Bun.serve<SocketData>({
      hostname: this.listenHost,
      port: s.port,
      fetch: (req, server) => this.fetch(req, server),
      websocket: {
        idleTimeout: 120,
        open: (ws) => {
          this.sockets.add(ws);
          if (this.update?.available) ws.send(eventMessage("update.available", this.update));
        },
        message: (ws, msg) => void this.onMessage(ws, msg),
        close: (ws) => {
          this.sockets.delete(ws);
          this.live.drop(ws);
        },
      },
    });
    const info: DaemonFile = { pid: process.pid, url: this.url, listen: this.listen, version: VERSION };
    writeFileSync(daemonFile(this.home), JSON.stringify(info), { mode: 0o600 });
  }

  /** After an update the old process may still hold the port for a moment. */
  private async listenWithRetry() {
    for (let i = 0; ; i++) {
      try {
        return this.listenOnce();
      } catch (e) {
        const inUse = /EADDRINUSE|in use/i.test(String((e as Error).message ?? e)) || (e as any)?.code === "EADDRINUSE";
        if (!inUse || i >= 15) throw e;
        await Bun.sleep(400);
      }
    }
  }

  async restartListener() {
    this.server?.stop(true);
    this.sockets.clear();
    this.web = await loadWebAssets();
    await this.listenWithRetry();
    this.log(`listening on ${this.listen}`);
  }

  private scheduleUpdateChecks() {
    const check = async () => {
      if (!this.settings.update.autoCheck) return;
      const { manifest, ...info } = await checkUpdate(this.settings);
      this.update = info;
      if (info.available) this.broadcast(eventMessage("update.available", info));
    };
    void check();
    this.updateTimer = setInterval(check, UPDATE_EVERY);
  }

  /** Next `autoFetchMinutes` round. Rounds never overlap: a timer that fires during a round is dropped, the round reschedules. */
  private scheduleAutoFetch() {
    if (this.autoFetch.timer) clearTimeout(this.autoFetch.timer);
    this.autoFetch.timer = null;
    const ms = this.settings.autoFetchMinutes * 60_000;
    if (!ms || !this.server) return;
    this.autoFetch.timer = setTimeout(() => void this.runAutoFetch(), ms);
  }

  private async runAutoFetch() {
    if (this.autoFetch.running) return;
    this.autoFetch.running = true;
    try {
      await fetchAll(this);
    } catch (e) {
      this.log(`auto-fetch failed: ${(e as Error).message}`);
    } finally {
      this.autoFetch.running = false;
      this.autoFetchRuns++;
      this.scheduleAutoFetch();
    }
  }

  broadcast(msg: string) {
    for (const ws of this.sockets) ws.send(msg);
  }

  /** Validate, persist and apply a settings patch (clients and CLI share this path). */
  updateSettings(patch: SettingsPatch, force = false) {
    const before = this.settings;
    const r = applyPatch(this.cfg.settings, patch, force || !!this.opts.force);
    for (const k of Object.keys(patch)) delete (this.overrides as any)[k];
    this.cfg.settings = r.settings;
    saveConfig(this.home, this.cfg);
    const now = this.settings;
    const restart = RESTART_KEYS.some((k) => now[k] !== before[k]);
    this.broadcast(eventMessage("settings.changed", toPublicSettings(now)));
    // Rotation or turning auth on disconnects sessions that no longer hold the token
    // (a moment later, so the caller still gets its response with the new token).
    setTimeout(() => {
      for (const ws of this.sockets) {
        if (this.settings.auth.enabled && !tokenEquals(ws.data.token, this.settings.auth.token)) ws.close(4001, "unauthorized");
      }
    }, 100);
    if (now.pollIntervalMs !== before.pollIntervalMs) this.live.start(now.pollIntervalMs);
    if (now.autoFetchMinutes !== before.autoFetchMinutes) this.scheduleAutoFetch();
    if (["roots", "repos", "exclude", "scanDepth"].some((k) => k in patch)) {
      void this.index.refresh().then(() => this.live.poke("repos"), () => {});
    }
    if (restart) setTimeout(() => void this.restartListener().catch((e) => this.log(`restart failed: ${e.message}`)), 300);
    return { settings: toPublicSettings(now), restartRequired: restart, token: r.token };
  }

  scheduleRestart() {
    setTimeout(() => {
      if (this.opts.restart) return this.opts.restart();
      restartProcess(() => {
        this.server?.stop(true);
        rmSync(daemonFile(this.home), { force: true });
      });
    }, 300);
  }

  private async onMessage(ws: Socket, raw: string | Buffer) {
    let id: unknown = null;
    try {
      const msg = JSON.parse(String(raw));
      id = msg?.id;
      if (typeof id !== "number" || typeof msg.method !== "string") fail("bad_request", "expected {id, method, params}");
      const result = await dispatch(this, msg.method, msg.params, ws);
      ws.send(JSON.stringify({ id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id, error: toRpcError(e) }));
    }
  }

  private json(data: unknown, status = 200, headers: Record<string, string> = {}) {
    return Response.json(data, { status, headers });
  }

  private async fetch(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    const s = this.settings;
    const p = url.pathname;

    if (p === "/api/health") {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      return this.json({ ok: true, name: this.name, version: VERSION, protocol: PROTOCOL_VERSION, authRequired: s.auth.enabled }, 200, cors);
    }

    if (p === "/ws") {
      const auth = authorize(req, s.auth, s.allowedOrigins);
      if (!auth.ok) return new Response(auth.message, { status: auth.status });
      const offered = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      // Browsers fail the handshake unless we pick an offered protocol; SDKs offer gitnut.v1 next to the bearer one.
      const proto = offered.includes(BASE_PROTOCOL) ? BASE_PROTOCOL : offered.find((x) => x.startsWith(BEARER_PROTOCOL_PREFIX));
      const ok = server.upgrade(req, { data: { token: auth.token }, headers: proto ? { "Sec-WebSocket-Protocol": proto } : undefined });
      return ok ? undefined : new Response("expected a WebSocket upgrade", { status: 426 });
    }

    if (p === "/api/login" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { token?: string };
      if (!tokenEquals(body.token, s.auth.token)) return this.json({ ok: false, error: "wrong token" }, 401);
      return this.json({ ok: true }, 200, { "set-cookie": authCookie(s.auth.token, isHttps(req)) });
    }
    if (p === "/api/logout" && req.method === "POST") {
      return this.json({ ok: true }, 200, { "set-cookie": authCookie("", isHttps(req), 0) });
    }

    // HTTP transport for one-shot calls (CLI, scripts). Same auth as /ws.
    if (p === "/api/rpc" || p === "/api/stop") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const auth = authorize(req, s.auth, s.allowedOrigins);
      if (!auth.ok) return this.json({ error: { code: "unauthorized", message: auth.message } }, auth.status);
      if (p === "/api/stop") {
        setTimeout(() => void this.stop(), 100);
        return this.json({ ok: true });
      }
      try {
        const msg = (await req.json()) as { method: string; params: unknown };
        return this.json({ result: await dispatch(this, msg.method, msg.params, null) });
      } catch (e) {
        const err = toRpcError(e);
        return this.json({ error: err }, err.code === "internal" ? 500 : 400);
      }
    }

    if (p.startsWith("/api/")) return new Response("not found", { status: 404 });
    if (!s.serveWeb || (req.method !== "GET" && req.method !== "HEAD")) return new Response("not found", { status: 404 });

    const token = url.searchParams.get("token");
    if (token !== null) {
      url.searchParams.delete("token");
      const headers: Record<string, string> = { location: url.pathname + url.search + url.hash };
      if (tokenEquals(token, s.auth.token)) headers["set-cookie"] = authCookie(s.auth.token, isHttps(req));
      return new Response(null, { status: 302, headers });
    }
    return serveWeb(this.web, p);
  }
}

export function toRpcError(e: unknown) {
  if (e instanceof GitnutError) return { code: e.code, message: e.message };
  if (e instanceof SyntaxError) return { code: "bad_request" as const, message: `bad JSON: ${e.message}` };
  return { code: "internal" as const, message: (e as Error)?.message ?? String(e) };
}
