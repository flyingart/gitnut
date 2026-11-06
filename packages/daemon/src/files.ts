import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { FileContent, FileSide } from "@gitnut/commons";
import { fail } from "./errors";
import { gitRaw, isHash } from "./git";

export const MAX_FILE = 5 * 1024 * 1024;
const SNIFF = 8000;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};
/** MIME type of a raster image path (SVG stays text: it diffs as source). */
export const imageMime = (path: string) => IMAGE_MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];

export function toContent(bytes: Uint8Array, size = bytes.length, path = ""): FileContent {
  if (size > MAX_FILE) return { binary: false, size, tooLarge: true };
  const mime = imageMime(path);
  if (mime) return { binary: true, size, image: { mime, base64: Buffer.from(bytes).toString("base64") } };
  if (bytes.subarray(0, SNIFF).includes(0)) return { binary: true, size };
  return { binary: false, size, text: new TextDecoder().decode(bytes) };
}

const escapes = (rel: string) => rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith("..\\") || isAbsolute(rel);

/**
 * Absolute path of a file inside a worktree. Rejects paths that leave the worktree, also through symlinked
 * folders (the file itself may be a symlink: callers must not follow it). Null when its folder does not exist.
 */
export async function insideWorktree(root: string, path: string): Promise<string | null> {
  const full = resolve(root, path);
  if (path.includes("\0") || escapes(relative(root, full)) || full === resolve(root)) fail("bad_request", "path escapes the worktree");
  const realRoot = await realpath(root);
  const realDir = await realpath(dirname(full)).catch(() => null);
  if (realDir === null) return null;
  if (escapes(relative(realRoot, realDir))) fail("bad_request", "path escapes the worktree");
  return full;
}

/** Read a worktree file. Rejects paths that leave the worktree, also through symlinked folders. */
export async function readWorktreeFile(root: string, path: string): Promise<FileContent | null> {
  const full = await insideWorktree(root, path);
  if (full === null) return null;
  const st = await lstat(full).catch(() => null);
  if (!st) return null;
  // Like git: a symlink's content is its target, never the file it points to.
  if (st.isSymbolicLink()) return toContent(new TextEncoder().encode(await readlink(full)));
  if (!st.isFile()) return null;
  if (st.size > MAX_FILE) return { binary: false, size: st.size, tooLarge: true };
  return toContent(new Uint8Array(await readFile(full)), undefined, path);
}

async function readBlob(cwd: string, spec: string, path: string): Promise<FileContent | null> {
  const size = await gitRaw(cwd, ["cat-file", "-s", spec], { allowFail: true });
  if (size.code !== 0) return null;
  const n = Number(new TextDecoder().decode(size.stdout).trim());
  if (n > MAX_FILE) return { binary: false, size: n, tooLarge: true };
  const blob = await gitRaw(cwd, ["cat-file", "blob", spec]);
  return toContent(blob.stdout, undefined, path);
}

/** Content of one side of a diff. `cwd` is the worktree (needed for INDEX / WORKTREE) or the repo. */
export async function readSide(cwd: string, side: FileSide | null, hasWorktree: boolean): Promise<FileContent | null> {
  if (side === null || side === undefined) return null;
  if (typeof side !== "object" || typeof side.path !== "string" || !side.path || typeof side.ref !== "string") {
    fail("bad_request", "side must be {ref, path}");
  }
  const path = side.path.replace(/\\/g, "/");
  if (path.includes("\0") || path.startsWith("/") || /^[a-z]:/i.test(path)) fail("bad_request", "path must be relative to the worktree");
  if (side.ref === "WORKTREE" || side.ref === "INDEX") {
    if (!hasWorktree) fail("bad_request", `${side.ref} needs a worktreeId`);
    return side.ref === "WORKTREE" ? readWorktreeFile(cwd, path) : readBlob(cwd, `:${path}`, path);
  }
  if (!isHash(side.ref)) fail("bad_request", "ref must be a commit hash, INDEX or WORKTREE");
  return readBlob(cwd, `${side.ref}:${path}`, path);
}
