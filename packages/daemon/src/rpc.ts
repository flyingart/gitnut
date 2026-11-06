import { platformOf, toPublicSettings, PROTOCOL_VERSION, type Method, type Platform, type ServerInfo } from "@gitnut/commons";
import { actionHandlers, obj } from "./actions";
import { repoPatch, rootPatch } from "./config";
import { fail } from "./errors";
import { readSide } from "./files";
import { git, gitOutput, gitRaw } from "./git";
import { commitsChanges } from "./graph";
import { browse, discoverIn, repoSummaries } from "./repos";
import type { Daemon, Socket } from "./server";
import { parseStatus, runStatus } from "./status";
import { applyUpdate, checkUpdate } from "./update";
import { VERSION } from "./version";

type Handler = (d: Daemon, p: any, ws: Socket | null) => Promise<unknown> | unknown;

async function listRepos(d: Daemon) {
  return repoSummaries(await d.index.refresh());
}

async function changeRepos(d: Daemon, op: "add" | "remove", path: unknown, kind: "repo" | "root" = "repo") {
  d.updateSettings((kind === "repo" ? repoPatch : rootPatch)(d.cfg.settings, op, path));
  const list = await listRepos(d);
  d.live.poke("repos");
  return list;
}

async function upstreamRemote(cwd: string): Promise<string[]> {
  const up = await gitRaw(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFail: true });
  if (up.code === 0) return ["push"];
  const remotes = (await git(cwd, ["remote"])).split("\n").filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : (remotes[0] ?? fail("bad_request", "no remote to push to"));
  return ["push", "-u", remote, "HEAD"];
}

const handlers: Record<Method, Handler> = {
  ...actionHandlers,
  "server.info": (d): ServerInfo => ({
    id: d.cfg.id,
    name: d.name,
    version: VERSION,
    platform: (platformOf(process.platform, process.arch) ?? "linux-x64") as Platform,
    protocol: PROTOCOL_VERSION,
    settings: toPublicSettings(d.settings),
    listen: d.listen,
  }),
  "settings.get": (d) => toPublicSettings(d.settings),
  "settings.update": (d, p) => {
    const { patch, force } = obj(p);
    return d.updateSettings(obj(patch), force === true);
  },
  "repos.list": (d) => listRepos(d),
  "repos.add": (d, p) => changeRepos(d, "add", obj(p).path),
  "repos.remove": (d, p) => changeRepos(d, "remove", obj(p).path),
  "roots.add": (d, p) => changeRepos(d, "add", obj(p).path, "root"),
  "roots.remove": (d, p) => changeRepos(d, "remove", obj(p).path, "root"),
  "fs.browse": (_d, p) => browse(p?.path),
  "repos.discover": async (d, p) => discoverIn(obj(p).path, p.depth, d.settings, await d.index.refresh()),

  "graph.get": async (d, p) => d.graphs.get(await d.index.repo(obj(p).repoId)),
  "graph.details": async (d, p) => d.graphs.details(await d.index.repo(obj(p).repoId), p.graphId, p.indices),
  "graph.filter": async (d, p) => ({ indices: await d.graphs.filter(await d.index.repo(obj(p).repoId), p.graphId, obj(p.filter)) }),
  "commit.full": async (d, p) => d.graphs.full(await d.index.repo(obj(p).repoId), p.hash),
  "commits.changes": async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    return commitsChanges(repo, p.hashes, (await d.graphs.latest(repo.id))?.index);
  },

  "worktree.status": async (d, p) => {
    const wt = await d.index.worktree(obj(p).worktreeId);
    const { changes, truncated } = parseStatus(await runStatus(wt.path));
    return { changes, truncated };
  },
  "file.diff": async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    let cwd = repo.path;
    if (p.worktreeId !== undefined && p.worktreeId !== null) {
      const wt = await d.index.worktree(p.worktreeId);
      if (wt.repoId !== repo.id) fail("bad_request", "worktree belongs to another repo");
      cwd = wt.path;
    }
    const hasWt = cwd !== repo.path || repo.worktrees.some((w) => w.path === repo.path);
    const [before, after] = await Promise.all([readSide(cwd, p.before, hasWt), readSide(cwd, p.after, hasWt)]);
    return { before, after };
  },
  "worktree.commit": async (d, p) => {
    const wt = await d.index.worktree(obj(p).worktreeId);
    const { message, paths = [], amend } = p;
    if (typeof message !== "string" || !message.trim()) fail("bad_request", "message required");
    if (!Array.isArray(paths) || !paths.every((x) => typeof x === "string" && x)) fail("bad_request", "paths must be strings");
    await git(wt.path, paths.length ? ["add", "-A", "--", ...paths] : ["add", "-A"], { write: true });
    await git(wt.path, ["commit", "-m", message, ...(amend === true ? ["--amend"] : []), ...(paths.length ? ["--", ...paths] : [])], {
      write: true,
    });
    const hash = (await git(wt.path, ["rev-parse", "HEAD"])).trim();
    d.live.poke(`worktree:${wt.id}`, `repo:${wt.repoId}`, "repos");
    return { hash };
  },
  "worktree.pull": async (d, p) => {
    const wt = await d.index.worktree(obj(p).worktreeId);
    const output = await gitOutput(wt.path, ["pull", "--no-edit"]);
    d.live.poke(`worktree:${wt.id}`, `repo:${wt.repoId}`);
    return { output };
  },
  "worktree.push": async (d, p) => {
    const wt = await d.index.worktree(obj(p).worktreeId);
    const output = await gitOutput(wt.path, await upstreamRemote(wt.path));
    d.live.poke(`worktree:${wt.id}`, `repo:${wt.repoId}`);
    return { output };
  },
  "repo.fetch": async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    const output = await gitOutput(repo.path, ["fetch", "--all", "--prune"]);
    d.live.poke(`repo:${repo.id}`);
    return { output };
  },

  "update.check": async (d) => {
    const { manifest, ...info } = await checkUpdate(d.settings);
    d.update = info;
    return info;
  },
  "update.apply": async (d) => {
    const version = await applyUpdate(d.settings);
    d.scheduleRestart();
    return { version, restarting: true };
  },

  subscribe: (d, p, ws) => {
    d.live.subscribe(ws ?? fail("bad_request", "subscribe needs a WebSocket"), obj(p).topics);
    return { ok: true };
  },
  unsubscribe: (d, p, ws) => {
    d.live.unsubscribe(ws ?? fail("bad_request", "unsubscribe needs a WebSocket"), obj(p).topics);
    return { ok: true };
  },
};

export function dispatch(d: Daemon, method: string, params: unknown, ws: Socket | null): Promise<unknown> {
  const h = Object.hasOwn(handlers, method) ? handlers[method as Method] : null;
  if (!h) fail("bad_request", `unknown method ${method}`);
  return Promise.resolve(h!(d, params, ws));
}
