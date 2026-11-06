import { GitnutError } from "./errors";

export interface GitOptions {
  /** Write commands may take locks; read commands run with GIT_OPTIONAL_LOCKS=0. */
  write?: boolean;
  timeoutMs?: number;
  /** Return non-zero exits instead of throwing. */
  allowFail?: boolean;
}

export interface GitResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

const MAX_PARALLEL = 12;
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export function gitEnv(write = false): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
  };
  if (!write) env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

export function gitRaw(cwd: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  return slot(async () => {
    const proc = Bun.spawn(["git", "-c", "core.quotepath=off", ...args], {
      cwd,
      env: gitEnv(opts.write),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? (opts.write ? 120_000 : 30_000));
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).bytes(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (proc.signalCode) throw new GitnutError("git_failed", `git ${args[0]} timed out`);
      if (code !== 0 && !opts.allowFail) {
        throw new GitnutError("git_failed", `git ${args[0]} failed: ${stderr.trim() || new TextDecoder().decode(stdout).trim()}`);
      }
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Run git and return stdout as text. Throws `git_failed` on non-zero exit. */
export async function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<string> {
  return new TextDecoder().decode((await gitRaw(cwd, args, opts)).stdout);
}

/** Run a network / write command and return stdout + stderr combined. */
export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const r = await gitRaw(cwd, args, { write: true, timeoutMs: 180_000 });
  return `${new TextDecoder().decode(r.stdout)}${r.stderr}`.trim();
}

/** Accept only hex object ids so user input can never become a git option or revision expression. */
export const isHash = (h: unknown): h is string => typeof h === "string" && /^[0-9a-f]{4,64}$/i.test(h);
