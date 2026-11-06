import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  buildGraph,
  type CommitDetails,
  type CommitFull,
  type FileChange,
  type FileContent,
  type FileSide,
  type GraphFilter,
  type GraphSnapshot,
  type LaidOutGraph,
  type PublicSettings,
  type RepoSummary,
  type SettingsPatch,
  type SortType,
  type Topic,
  type UpdateInfo,
  type WorktreeSummary,
} from "@gitnut/commons";
import { GitnutRpcError, servesThisPage, type GitnutConnection } from "./connection";
import { useConnection, useConnectionState, type ServerProp } from "./provider";
import type { Query, QueryState } from "./query";
import { desktopApp } from "./desktop";

const EMPTY: QueryState<any> = { data: undefined, error: null, loading: false };
const noop = () => () => {};

/** Subscribe to a shared connection query. `key: null` = disabled. */
export function useQuery<T>(conn: GitnutConnection | null, key: string | null, fetcher: () => Promise<T>, topic?: Topic): QueryState<T> {
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const q = useMemo(() => (conn && key ? conn.query<T>(key, () => fetchRef.current(), topic) : null), [conn, key, topic]);
  return useSyncExternalStore(q?.subscribe ?? noop, q?.getSnapshot ?? (() => EMPTY));
}

/** Repositories (with worktrees) of a server, live. */
export function useRepos(server?: ServerProp) {
  const conn = useConnection(server);
  const st = useConnectionState(conn);
  const q = useQuery(conn, st.state === "unauthorized" ? null : "repos", () => conn!.call("repos.list"), REPOS_TOPIC);
  return { repos: q.data ?? [], loading: q.data === undefined && st.state !== "offline", error: q.error, conn, state: st.state };
}

/** Find a worktree by id or absolute path (live summary + its repo). */
export function useWorktree(pathOrId: string | undefined, server?: ServerProp) {
  const { repos, loading, conn, state } = useRepos(server);
  return useMemo(() => {
    const norm = (p: string) => p.replace(/[\\/]+$/, "");
    for (const repo of repos) {
      for (const wt of repo.worktrees) {
        if (pathOrId && (wt.id === pathOrId || norm(wt.path) === norm(pathOrId))) return { worktree: wt, repo, loading: false, conn, state };
      }
    }
    return { worktree: null as WorktreeSummary | null, repo: null as RepoSummary | null, loading, conn, state };
  }, [repos, pathOrId, loading, conn, state]);
}

// ---- graph ----------------------------------------------------------------------------

/** Lazily loaded commit rows (subject, author, date, hash) of one graph snapshot. */
export class DetailsCache {
  private map = new Map<number, CommitDetails>();
  private requested = new Set<number>();
  private queue = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(
    private conn: GitnutConnection,
    private repoId: string,
    readonly graphId: string,
    private onStale: () => void,
  ) {}

  get(index: number): CommitDetails | undefined {
    return this.map.get(index);
  }

  /** Request details for commit indices (batched). */
  ensure(indices: Iterable<number>) {
    for (const i of indices) if (i >= 0 && !this.requested.has(i)) this.queue.add(i);
    if (this.queue.size && !this.timer) this.timer = setTimeout(() => this.flush(), 0);
  }

  /** Details for indices, fetching what is missing. */
  async load(indices: number[]): Promise<CommitDetails[]> {
    const missing = indices.filter((i) => !this.map.has(i));
    if (missing.length) await this.fetch(missing);
    return indices.map((i) => this.map.get(i)).filter((d): d is CommitDetails => !!d);
  }

  private flush() {
    this.timer = null;
    const batch = [...this.queue];
    this.queue.clear();
    for (let i = 0; i < batch.length; i += 500) void this.fetch(batch.slice(i, i + 500)).catch(() => {});
  }

  private async fetch(indices: number[]) {
    for (const i of indices) this.requested.add(i);
    try {
      const rows = await this.conn.call("graph.details", { repoId: this.repoId, graphId: this.graphId, indices });
      for (const d of rows) this.map.set(d.index, d);
      this.version++;
      for (const fn of [...this.listeners]) fn();
    } catch (e) {
      for (const i of indices) this.requested.delete(i);
      if (e instanceof GitnutRpcError && e.code === "not_found") this.onStale();
      throw e;
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
}

const detailCaches = new Map<string, DetailsCache>();
function detailsFor(conn: GitnutConnection, repoId: string, graphId: string, onStale: () => void) {
  const key = `${conn.url}\0${repoId}\0${graphId}`;
  let c = detailCaches.get(key);
  if (!c) {
    detailCaches.set(key, (c = new DetailsCache(conn, repoId, graphId, onStale)));
    while (detailCaches.size > 8) detailCaches.delete(detailCaches.keys().next().value!);
  }
  return c;
}

export interface UseGraphOptions {
  sort?: SortType;
  showLongEdges?: boolean;
  /** Text / author / path / date filter (evaluated by the daemon). */
  filter?: GraphFilter;
  /** Branch filter: full ref names; only commits reachable from them are shown. */
  branches?: string[];
}

export interface GraphData {
  snapshot: GraphSnapshot | undefined;
  graph: LaidOutGraph | null;
  details: DetailsCache | null;
  loading: boolean;
  /** True while the daemon evaluates a filter. */
  filtering: boolean;
  error: Error | null;
  refetch(): void;
  conn: GitnutConnection | null;
}

const hasFilter = (f?: GraphFilter) => !!f && Object.values(f).some((v) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));

/** Commit graph of a repository: live snapshot, IntelliJ layout, lazy commit details, filters. */
export function useGraph(repoId: string | undefined, server?: ServerProp, opts: UseGraphOptions = {}): GraphData {
  const conn = useConnection(server);
  const q = useQuery(conn, repoId ? `graph:${repoId}` : null, () => conn!.call("graph.get", { repoId: repoId! }), repoId ? `repo:${repoId}` : undefined);
  const snap = q.data;
  const refetch = useCallback(() => conn?.query(`graph:${repoId}`, () => conn.call("graph.get", { repoId: repoId! })).refetch(), [conn, repoId]);
  const filterKey = hasFilter(opts.filter) ? JSON.stringify(opts.filter) : null;
  const fq = useQuery(
    conn,
    snap && filterKey ? `filter:${repoId}:${snap.graphId}:${filterKey}` : null,
    () => conn!.call("graph.filter", { repoId: repoId!, graphId: snap!.graphId, filter: opts.filter! }),
  );
  const branchKey = opts.branches?.length ? opts.branches.join("\0") : "";
  const graph = useMemo(() => {
    if (!snap) return null;
    if (filterKey && !fq.data) return null;
    const visible = filterKey && fq.data ? new Set(fq.data.indices) : undefined;
    let visibleHeads: number[] | undefined;
    if (branchKey) {
      const want = new Set(branchKey.split("\0"));
      visibleHeads = snap.refs.filter((r) => want.has(r.full)).map((r) => r.commit);
    }
    return buildGraph({ parents: snap.parents, times: snap.times, refs: snap.refs, visible, visibleHeads }, { sort: opts.sort, showLongEdges: opts.showLongEdges });
  }, [snap, fq.data, filterKey, branchKey, opts.sort, opts.showLongEdges]);
  const details = useMemo(() => (conn && snap && repoId ? detailsFor(conn, repoId, snap.graphId, refetch) : null), [conn, snap, repoId, refetch]);
  return {
    snapshot: snap,
    graph,
    details,
    loading: !snap && !q.error,
    filtering: !!filterKey && !fq.data && !fq.error,
    error: q.error ?? fq.error,
    refetch,
    conn,
  };
}

/** Re-render when lazily loaded commit details arrive. */
export function useDetailsVersion(details: DetailsCache | null) {
  return useSyncExternalStore(details?.subscribe ?? noop, () => details?.version ?? 0);
}

/** Full commit (message body, committer, parents). */
export function useCommitDetails(repoId: string | undefined, hash: string | null | undefined, server?: ServerProp) {
  const conn = useConnection(server);
  const q = useQuery<CommitFull>(conn, repoId && hash ? `full:${repoId}:${hash}` : null, () => conn!.call("commit.full", { repoId: repoId!, hash: hash! }));
  return { commit: q.data ?? null, loading: q.loading && !q.data, error: q.error };
}

/** Combined changes of several commits (IntelliJ zipChanges semantics). */
export function useCommitsChanges(repoId: string | undefined, hashes: string[], server?: ServerProp) {
  const conn = useConnection(server);
  const key = repoId && hashes.length ? `changes:${repoId}:${[...hashes].sort().join(",")}` : null;
  const q = useQuery(conn, key, () => conn!.call("commits.changes", { repoId: repoId!, hashes }));
  return { changes: q.data?.changes ?? EMPTY_CHANGES, truncated: q.data?.truncated ?? false, loading: !!key && !q.data && !q.error, error: q.error };
}
const EMPTY_CHANGES: FileChange[] = [];

/** Live uncommitted changes of one worktree. */
export function useLocalChanges(worktreeId: string | undefined | null, server?: ServerProp) {
  const conn = useConnection(server);
  const q = useQuery<{ changes: FileChange[]; truncated?: boolean }>(
    conn,
    worktreeId ? `status:${worktreeId}` : null,
    () => conn!.call("worktree.status", { worktreeId: worktreeId! }),
    worktreeId ? `worktree:${worktreeId}` : undefined,
  );
  return { changes: q.data?.changes ?? EMPTY_CHANGES, truncated: !!q.data?.truncated, loading: !!worktreeId && !q.data && !q.error, error: q.error, conn };
}

export interface FileDiffRequest {
  server?: ServerProp;
  repoId: string;
  worktreeId?: string;
  before: FileSide | null;
  after: FileSide | null;
}

/** Both sides of a file change. Worktree / index sides refresh when the worktree changes. */
export function useFileDiff(req: FileDiffRequest | null) {
  const conn = useConnection(req?.server);
  const live = !!req && [req.before?.ref, req.after?.ref].some((r) => r === "WORKTREE" || r === "INDEX");
  const key = req ? `diff:${req.repoId}:${req.worktreeId ?? ""}:${JSON.stringify([req.before, req.after])}` : null;
  const q = useQuery<{ before: FileContent | null; after: FileContent | null }>(conn, key, () =>
    conn!.call("file.diff", { repoId: req!.repoId, worktreeId: req!.worktreeId, before: req!.before, after: req!.after }),
  );
  useEffect(() => {
    if (!conn || !key || !live || !req?.worktreeId) return;
    const id = req.worktreeId;
    return conn.on("worktree.changed", (wt) => {
      if (wt.id === id) conn.query(key, () => Promise.reject()).refetch();
    });
  }, [conn, key, live, req?.worktreeId]);
  return { before: q.data?.before ?? null, after: q.data?.after ?? null, loading: !!key && !q.data && !q.error, error: q.error, ready: !!q.data };
}

/** Daemon settings (live) and an update function. */
export function useSettings(server?: ServerProp) {
  const conn = useConnection(server);
  const st = useConnectionState(conn);
  const q = useQuery<PublicSettings>(conn, st.state === "unauthorized" ? null : "settings", () => conn!.call("settings.get"));
  const update = useCallback(
    async (patch: SettingsPatch, force?: boolean) => {
      const r = await conn!.call("settings.update", { patch, force });
      conn!.query("settings", () => conn!.call("settings.get")).set(r.settings);
      return r;
    },
    [conn],
  );
  return { settings: q.data ?? null, loading: !q.data && !q.error, error: q.error, update, conn };
}

export type UpdatePhase = "idle" | "checking" | "applying" | "restarting" | "done" | "error";

/** Shown for a daemon that came with the desktop app (UpdateInfo.managedBy). */
/** Live topic of the repo list (shared by useRepos and useReposOf, so both use one cached query). */
const REPOS_TOPIC = "repos";

export const UPDATES_WITH_APP = "Updates come with the GitNut desktop app";

/**
 * Update state and actions for one server, the single update path of the UI (update icon, Settings).
 * Inside the desktop app its own daemon updates with the app (Tauri updater: app + daemon in one
 * step); every other daemon updates itself (`update.check` / `update.apply`).
 */
export function useUpdate(server?: ServerProp) {
  const conn = useConnection(server);
  const viaApp = !!desktopApp && !!conn && servesThisPage(conn.url);
  const daemon = useDaemonUpdate(viaApp ? null : conn);
  const app = useAppUpdate(viaApp);
  return { ...(viaApp ? app : daemon), conn, viaApp };
}

const APP_CHECK_EVERY = 10 * 60_000;

function useAppUpdate(enabled: boolean) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const check = useCallback(async (quiet = false) => {
    if (!desktopApp) return;
    if (!quiet) setPhase("checking");
    try {
      const i = await desktopApp.checkUpdate();
      setInfo(i);
      setPhase("idle");
      if (!quiet) setMessage(i.available ? null : "You're on the latest version");
    } catch (e) {
      setPhase(quiet ? "idle" : "error");
      if (!quiet) setMessage((e as Error).message ?? String(e));
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void check(true);
    const t = setInterval(() => void check(true), APP_CHECK_EVERY);
    return () => clearInterval(t);
  }, [enabled, check]);
  const apply = useCallback(async () => {
    if (!desktopApp) return;
    setPhase("applying");
    setMessage("Downloading the update…");
    try {
      await desktopApp.installUpdate(); // the app relaunches when done
      setPhase("restarting");
      setMessage("Restarting…");
    } catch (e) {
      setPhase("error");
      setMessage((e as Error).message ?? String(e));
    }
  }, []);
  return { info, phase, message, check: () => check(false), apply };
}

function useDaemonUpdate(conn: GitnutConnection | null) {
  const st = useConnectionState(conn);
  const q = useQuery<UpdateInfo>(conn, conn && st.state === "open" ? "update" : null, () => conn!.call("update.check"));
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const sawOffline = useRef(false);

  useEffect(() => {
    if (phase !== "restarting") return;
    if (st.state !== "open") sawOffline.current = true;
    else if (sawOffline.current && st.info) {
      setPhase("done");
      setMessage(`Updated to ${st.info.version}`);
      conn?.query("update", () => conn.call("update.check")).refetch();
    }
  }, [phase, st.state, st.info, conn]);

  const check = useCallback(async () => {
    if (!conn) return;
    setPhase("checking");
    try {
      const info = await conn.call("update.check");
      conn.query("update", () => conn.call("update.check")).set(info);
      setPhase("idle");
      setMessage(info.error ?? (info.managedBy ? UPDATES_WITH_APP : info.available ? null : "You're on the latest version"));
    } catch (e) {
      setPhase("error");
      setMessage((e as Error).message);
    }
  }, [conn]);

  const apply = useCallback(async () => {
    if (!conn) return;
    setPhase("applying");
    setMessage("Downloading…");
    try {
      const r = await conn.call("update.apply");
      sawOffline.current = false;
      setPhase("restarting");
      setMessage(`Installing ${r.version}, restarting…`);
    } catch (e) {
      setPhase("error");
      setMessage((e as Error).message);
    }
  }, [conn]);

  return { info: q.data ?? null, phase, message, check, apply };
}

/** Only the graph snapshot (refs, parents) without building a layout. Shares the fetch with useGraph. */
export function useGraphSnapshot(repoId: string | undefined, server?: ServerProp) {
  const conn = useConnection(server);
  const q = useQuery(conn, repoId ? `graph:${repoId}` : null, () => conn!.call("graph.get", { repoId: repoId! }), repoId ? `repo:${repoId}` : undefined);
  return { snapshot: q.data, loading: !q.data && !q.error, error: q.error, conn };
}

/** Subscribe to several shared queries at once (lists of servers / worktrees). Keep `qs` memoized. */
export function useQueries<T>(qs: Query<T>[]): QueryState<T>[] {
  const subscribe = useCallback(
    (fn: () => void) => {
      const offs = qs.map((q) => q.subscribe(fn));
      return () => offs.forEach((o) => o());
    },
    [qs],
  );
  const last = useRef<QueryState<T>[]>([]);
  const get = () => {
    const next = qs.map((q) => q.getSnapshot());
    if (next.length === last.current.length && next.every((s, i) => s === last.current[i])) return last.current;
    return (last.current = next);
  };
  return useSyncExternalStore(subscribe, get, get);
}

/** Repos of several connections (one shared `repos` query each). */
export function useReposOf(conns: GitnutConnection[]) {
  const qs = useMemo(() => conns.map((c) => c.query("repos", () => c.call("repos.list"), REPOS_TOPIC)), [conns]);
  return useQueries(qs);
}
