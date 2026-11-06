// Wire protocol between the gitnut daemon and its clients.
// Transport: one WebSocket per server at `/ws`, JSON text frames.
//   client -> server: { id, method, params }
//   server -> client: { id, result } | { id, error } | { event, data }

import type { Platform } from "./platform";
import type { PublicSettings, SettingsPatch } from "./settings";

export const PROTOCOL_VERSION = 1;

/** Stable id of a repository: sha1 of its git common dir, first 12 hex chars. */
export type RepoId = string;
/** Stable id of a worktree: sha1 of its absolute path, first 12 hex chars. */
export type WorktreeId = string;

export interface ServerInfo {
  /** Stable random id of this daemon install (stored in the config dir). */
  id: string;
  /** Display name: `settings.name` or the hostname. */
  name: string;
  version: string;
  platform: Platform;
  protocol: number;
  settings: PublicSettings;
  /** Address the daemon listens on right now, for example `100.101.102.103:7420`. */
  listen: string;
}

export interface WorktreeCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface WorktreeSummary {
  id: WorktreeId;
  repoId: RepoId;
  path: string;
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  isMain: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  counts: WorktreeCounts;
}

export interface RepoSummary {
  id: RepoId;
  /** Folder name of the main worktree. */
  name: string;
  /** Path of the main worktree (or the git dir for bare repos). */
  path: string;
  /** Root folder from settings that contains this repo, or null for explicit repos. */
  root: string | null;
  worktrees: WorktreeSummary[];
}

export type RefKind = "head" | "local" | "remote" | "tag";

export interface RefInfo {
  /** Short name: `main`, `origin/main`, `v1.0`, `HEAD`. */
  name: string;
  /** Full name: `refs/heads/main`, `HEAD`. */
  full: string;
  kind: RefKind;
  /** Commit index in the snapshot. */
  commit: number;
  /** Paths of worktrees that have this branch checked out. */
  worktrees: string[];
}

/**
 * Whole commit graph of one repository (all refs). Commit `i` has parents
 * `parents[i]` (indices into the same arrays). Order is `git log --all --date-order`,
 * so children always come before parents. The graph module may reorder rows.
 */
export interface GraphSnapshot {
  repoId: RepoId;
  /** Changes whenever refs change. Indices are valid only within one graphId. */
  graphId: string;
  count: number;
  parents: number[][];
  /** Committer time, unix seconds. */
  times: number[];
  refs: RefInfo[];
}

export interface CommitDetails {
  index: number;
  hash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  authorTime: number;
  commitTime: number;
}

export interface CommitFull extends CommitDetails {
  body: string;
  committerName: string;
  committerEmail: string;
  parents: string[];
}

export interface GraphFilter {
  /** Case-insensitive match in the commit message. */
  text?: string;
  /** Case-insensitive match in author name or email. */
  author?: string;
  /** Only commits that touch this path (file or folder, relative to repo root). */
  path?: string;
  /** Only commits reachable from these refs (full names). */
  refs?: string[];
  /** Unix seconds. */
  since?: number;
  until?: number;
}

export type ChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflicted"
  | "untracked";

/** `ref` is a commit hash, `INDEX` (staged) or `WORKTREE` (file on disk). */
export interface FileSide {
  ref: string;
  path: string;
}

export interface FileChange {
  /** Path after the change (or the deleted path). */
  path: string;
  /** Set for renames and copies. */
  oldPath?: string;
  status: ChangeStatus;
  before: FileSide | null;
  after: FileSide | null;
  /** Set for local changes: true when the change is staged in the index. */
  staged?: boolean;
}

export interface FileContent {
  binary: boolean;
  size: number;
  /** Missing when binary or tooLarge. */
  text?: string;
  tooLarge?: boolean;
  /** Raster images (png, jpg, gif, webp, bmp, ico, avif): the bytes as base64, for the image diff. */
  image?: { mime: string; base64: string };
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  notes?: string;
  publishedAt?: string;
  /** Download page for desktop apps. */
  downloadUrl?: string;
  error?: string;
  /** Set when the daemon came with the desktop app: it updates with the app, not by itself. */
  managedBy?: "desktop";
}

/** Update manifest served by the website (`/manifest.json`). */
export interface UpdateManifest {
  version: string;
  notes?: string;
  publishedAt?: string;
  downloadPage?: string;
  /** Key: platform target such as `linux-x64`. */
  assets: Record<string, { url: string; sha256?: string }>;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  /** Sub-folders, dot folders skipped. `repo`: the folder is a git repository. */
  dirs: { name: string; path: string; repo: boolean }[];
}

export interface DiscoverResult {
  path: string;
  /** The watched folder (`roots` entry) that covers this folder, or null. Equal to `path` when the folder itself is watched. */
  watchedBy: string | null;
  repos: { path: string; name: string; added: boolean }[];
}

/** Result of a git action: the combined stdout + stderr of git. */
export interface ActionResult {
  output: string;
}

export interface FetchAllEntry {
  repoId: RepoId;
  name: string;
  ok: boolean;
  /** git output, or the error message when `ok` is false. */
  output: string;
}

export interface StashEntry {
  /** `stash@{0}` */
  ref: string;
  hash: string;
  /** Unix seconds. */
  time: number;
  message: string;
}

export type ResetMode = "soft" | "mixed" | "hard";

export type Topic = "repos" | `repo:${RepoId}` | `worktree:${WorktreeId}`;

export interface Methods {
  "server.info": { params: void; result: ServerInfo };
  "settings.get": { params: void; result: PublicSettings };
  "settings.update": {
    params: { patch: SettingsPatch; force?: boolean };
    result: { settings: PublicSettings; restartRequired: boolean; token?: string };
  };
  "repos.list": { params: void; result: RepoSummary[] };
  "repos.add": { params: { path: string }; result: RepoSummary[] };
  /** Remove an explicit repo, or hide one found in a watched folder (adds it to `exclude`). */
  "repos.remove": { params: { path: string }; result: RepoSummary[] };
  /** Watch a whole folder: every repo under it (to `scanDepth`) shows up, also new ones. */
  "roots.add": { params: { path: string }; result: RepoSummary[] };
  "roots.remove": { params: { path: string }; result: RepoSummary[] };
  /** Folders of the daemon's machine, for the "Add projects" picker. Default path: home folder. */
  "fs.browse": { params: { path?: string }; result: BrowseResult };
  /** Git repositories under a folder (to `depth`, default `scanDepth`), and whether each is listed already. */
  "repos.discover": { params: { path: string; depth?: number }; result: DiscoverResult };
  "graph.get": { params: { repoId: RepoId }; result: GraphSnapshot };
  "graph.details": {
    params: { repoId: RepoId; graphId: string; indices: number[] };
    result: CommitDetails[];
  };
  "graph.filter": {
    params: { repoId: RepoId; graphId: string; filter: GraphFilter };
    result: { indices: number[] };
  };
  "commit.full": { params: { repoId: RepoId; hash: string }; result: CommitFull };
  /** Combined changes of the given commits (IntelliJ zipChanges semantics). */
  "commits.changes": {
    params: { repoId: RepoId; hashes: string[] };
    result: { changes: FileChange[]; truncated: boolean };
  };
  "worktree.status": {
    params: { worktreeId: WorktreeId };
    /** `truncated`: more than 5000 changed paths; only the first 5000 are listed. */
    result: { changes: FileChange[]; truncated?: boolean };
  };
  "file.diff": {
    params: { repoId: RepoId; worktreeId?: WorktreeId; before: FileSide | null; after: FileSide | null };
    result: { before: FileContent | null; after: FileContent | null };
  };
  "worktree.commit": {
    params: { worktreeId: WorktreeId; message: string; paths: string[]; amend?: boolean };
    result: { hash: string };
  };
  "worktree.pull": { params: { worktreeId: WorktreeId }; result: { output: string } };
  "worktree.push": { params: { worktreeId: WorktreeId }; result: { output: string } };
  "repo.fetch": { params: { repoId: RepoId }; result: { output: string } };
  /** Fetch every repository of this daemon, one after another. Failures are reported per repo. */
  "repos.fetchAll": { params: void; result: { results: FetchAllEntry[] } };
  /**
   * Check out in a worktree. `ref`: a local branch (switch), a remote branch (creates the same-named local
   * tracking branch; fails when that name exists already), a tag or commit hash (detached HEAD). With
   * `newBranch`: create that branch at `ref` and switch to it. Git refuses when local changes would be overwritten.
   */
  "worktree.checkout": { params: { worktreeId: WorktreeId; ref: string; newBranch?: string }; result: ActionResult & { branch: string | null } };
  /** Create a local branch at a commit or ref (without checking it out). */
  "repo.branch.create": { params: { repoId: RepoId; name: string; at: string }; result: ActionResult };
  /**
   * Delete a branch. Local: `git branch -d` (`-D` with `force`). `remote`: `name` is `origin/x` and the branch is
   * deleted on the remote (`git push origin --delete x`).
   */
  "repo.branch.delete": { params: { repoId: RepoId; name: string; remote?: boolean; force?: boolean }; result: ActionResult };
  /** Push a local branch to its remote (sets the upstream when it has none). */
  "repo.branch.push": { params: { repoId: RepoId; name: string }; result: ActionResult };
  /** Create a tag at a commit or ref; annotated when `message` is given. */
  "repo.tag.create": { params: { repoId: RepoId; name: string; at: string; message?: string }; result: ActionResult };
  "repo.tag.delete": { params: { repoId: RepoId; name: string }; result: ActionResult };
  /** Cherry-pick commits, oldest first. On conflicts the pick is aborted and the error code is `conflict`. */
  "worktree.cherryPick": { params: { worktreeId: WorktreeId; hashes: string[] }; result: ActionResult };
  /** Revert commits (newest first, one revert commit each). Conflicts abort, error code `conflict`. */
  "worktree.revert": { params: { worktreeId: WorktreeId; hashes: string[] }; result: ActionResult };
  /** Merge a ref into the worktree's HEAD. Conflicts abort, error code `conflict`. */
  "worktree.merge": { params: { worktreeId: WorktreeId; ref: string }; result: ActionResult };
  /** Rebase the worktree's branch onto a ref. Conflicts abort, error code `conflict`. */
  "worktree.rebase": { params: { worktreeId: WorktreeId; onto: string }; result: ActionResult };
  /** Reset the worktree's HEAD (current branch) to a commit. */
  "worktree.reset": { params: { worktreeId: WorktreeId; to: string; mode: ResetMode }; result: ActionResult };
  /** Roll back changed files: tracked files are restored from HEAD (index and disk), untracked files are deleted. */
  "worktree.discard": { params: { worktreeId: WorktreeId; paths: string[] }; result: ActionResult };
  "worktree.stash": { params: { worktreeId: WorktreeId; message?: string; includeUntracked?: boolean }; result: ActionResult };
  /** Apply and drop the latest stash. On conflicts the worktree is reset and the stash kept (error code `conflict`). */
  "worktree.stashPop": { params: { worktreeId: WorktreeId }; result: ActionResult };
  /** Stashes of a repository, newest first. */
  "repo.stashes": { params: { repoId: RepoId }; result: StashEntry[] };
  "update.check": { params: void; result: UpdateInfo };
  "update.apply": { params: void; result: { version: string; restarting: boolean } };
  subscribe: { params: { topics: Topic[] }; result: { ok: true } };
  unsubscribe: { params: { topics: Topic[] }; result: { ok: true } };
}

export type Method = keyof Methods;
export type ParamsOf<M extends Method> = Methods[M]["params"];
export type ResultOf<M extends Method> = Methods[M]["result"];

export interface Events {
  "repos.changed": RepoSummary[];
  "graph.changed": { repoId: RepoId; graphId: string };
  "worktree.changed": WorktreeSummary;
  "settings.changed": PublicSettings;
  "update.available": UpdateInfo;
}
export type EventName = keyof Events;

export interface RequestMessage<M extends Method = Method> {
  id: number;
  method: M;
  params: ParamsOf<M>;
}

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "git_failed"
  | "conflict"
  | "internal";

export interface RpcError {
  code: ErrorCode;
  message: string;
}

export type ResponseMessage =
  | { id: number; result: unknown }
  | { id: number; error: RpcError };

export interface EventMessage<E extends EventName = EventName> {
  event: E;
  data: Events[E];
}

/** WebSocket subprotocol carrying a token: `gitnut.bearer.<token>` (tokens use only [A-Za-z0-9_-]). */
export const BEARER_PROTOCOL_PREFIX = "gitnut.bearer.";
export const BASE_PROTOCOL = "gitnut.v1";
export const AUTH_COOKIE = "gitnut_token";
export const DEFAULT_PORT = 7420;
