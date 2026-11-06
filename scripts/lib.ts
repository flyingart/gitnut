// Shared helpers of the build and release scripts.
import { resolve } from "node:path";
import * as p from "@clack/prompts";

export const ROOT = resolve(import.meta.dir, "..");
/** Questions are asked only on a terminal and without `--yes`; otherwise defaults apply. */
export const interactive = !!process.stdin.isTTY && !process.argv.includes("--yes");

interface RunOptions {
  /** Print the command and show its output (stdin too) instead of returning it. */
  live?: boolean;
  cwd?: string;
  /** Added to process.env. */
  env?: Record<string, string | undefined>;
  /** Don't throw on a non-zero exit. */
  allowFail?: boolean;
}

const spawn = (cmd: string[], { live, cwd = ROOT, env }: RunOptions) =>
  Bun.spawnSync(cmd, { cwd, env: env && { ...process.env, ...env }, stdio: live ? ["inherit", "inherit", "inherit"] : ["ignore", "pipe", "pipe"] });

/** Run a command; returns its trimmed stdout (nothing when `live`). Throws when it fails, with its stderr. */
export function run(cmd: string[], opts: RunOptions = {}): string {
  if (opts.live) console.log(`$ ${cmd.join(" ")}`);
  const r = spawn(cmd, opts);
  if (r.exitCode !== 0 && !opts.allowFail) throw new Error(`${cmd.slice(0, 3).join(" ")} failed${opts.live ? "" : `: ${String(r.stderr ?? "").trim()}`}`);
  return opts.live ? "" : String(r.stdout ?? "").trim();
}

/** True when the command exists and exits with 0. */
export function ok(cmd: string[], opts: RunOptions = {}): boolean {
  try {
    return spawn(cmd, opts).exitCode === 0;
  } catch {
    return false; // not installed
  }
}

/** Is `bin` on PATH (PATHEXT on Windows)? */
export const has = (bin: string) => Bun.which(bin) !== null;

/** Await a @clack prompt; Ctrl+C / Escape ends the script. */
export async function ask<T>(v: Promise<T | symbol>): Promise<Exclude<T, symbol>> {
  const r = await v;
  if (p.isCancel(r)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
  return r as Exclude<T, symbol>;
}

/** Yes / no question; `initialValue` without a terminal or with `--yes`. */
export async function confirm(message: string, initialValue = true): Promise<boolean> {
  return interactive ? ask(p.confirm({ message, initialValue })) : initialValue;
}

/**
 * GITNUT_SITE_URL without a trailing slash; ends the script with a hint when it is missing. Every shipped binary
 * bakes it in: updates come from `<site>/manifest.json`.
 */
export function requireSiteUrl(hint = ""): string {
  const site = process.env.GITNUT_SITE_URL?.replace(/\/+$/, "");
  if (site) return site;
  console.error(`Set GITNUT_SITE_URL in .env (e.g. GITNUT_SITE_URL=https://gitnut.dev): binaries need to know where updates come from.${hint}`);
  process.exit(1);
}
