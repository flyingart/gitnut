#!/usr/bin/env bun
// Dev loop: daemon (watch), web Vite dev server and the website, all bound to 0.0.0.0.
//   bun run dev
// Env: GITNUT_DEV_HOST (host shown in URLs), GITNUT_DEV_HOME (daemon config, default .cache/dev-home).
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const HOST = process.env.GITNUT_DEV_HOST ?? "localhost";
const HOME = resolve(process.env.GITNUT_DEV_HOME ?? join(ROOT, ".cache", "dev-home"));
const SITE_PORT = process.env.SITE_PORT ?? "7431";
mkdirSync(HOME, { recursive: true });

const procs: { name: string; cmd: string[]; cwd?: string; env?: Record<string, string> }[] = [];
const urls: string[] = [];
const hasWeb = existsSync(join(ROOT, "packages", "web", "package.json"));
const hasDaemon = existsSync(join(ROOT, "packages", "daemon", "src", "cli.ts"));

if (hasDaemon) {
  procs.push({ name: "daemon", cmd: ["bun", "--watch", "packages/daemon/src/cli.ts", "serve", "--bind", "all"], env: { GITNUT_HOME: HOME } });
  urls.push(`daemon + bundled web  http://${HOST}:7420   (token: GITNUT_HOME=${HOME} bun packages/daemon/src/cli.ts token)`);
}
if (hasWeb) {
  procs.push({ name: "web", cmd: ["bun", "run", "dev"], cwd: join(ROOT, "packages", "web"), env: { GITNUT_DEV_DAEMON: "http://127.0.0.1:7420" } });
  urls.push(`web (Vite)            http://${HOST}:5174   (proxies /ws and /api to the daemon)`);
}
// Site: astro dev (pages, live reload) proxies the dynamic routes to the Bun server on SITE_API_PORT.
// The Bun server reads install scripts and robots.txt from dist/, so build once first.
const SITE_API_PORT = process.env.SITE_API_PORT ?? "7432";
const SITE = join(ROOT, "packages", "site");
if (Bun.spawnSync(["bun", "run", "build"], { cwd: SITE, stdout: "inherit", stderr: "inherit" }).exitCode !== 0) process.exit(1);
procs.push({
  name: "site-api",
  cmd: ["bun", "--watch", "server/server.ts"],
  cwd: SITE,
  env: {
    PORT: SITE_API_PORT,
    HOST: "127.0.0.1",
    // releases (versions, downloads, changelog) come from GitHub, like in production
    GITNUT_GITHUB_REPO: process.env.GITNUT_GITHUB_REPO ?? "flyingart/gitnut",
  },
});
procs.push({
  name: "site",
  cmd: ["bun", "--bun", "astro", "dev", "--host", "0.0.0.0", "--port", SITE_PORT],
  cwd: SITE,
  env: { GITNUT_SITE_API: `http://127.0.0.1:${SITE_API_PORT}` },
});
urls.push(`site                  http://${HOST}:${SITE_PORT}`);

const children = procs.map((p) => {
  const child = Bun.spawn(p.cmd, { cwd: p.cwd ?? ROOT, env: { ...process.env, ...p.env }, stdout: "pipe", stderr: "pipe" });
  for (const stream of [child.stdout, child.stderr]) pipe(p.name, stream);
  return child;
});

async function pipe(name: string, stream: ReadableStream<Uint8Array>) {
  const tag = `[${name}]`.padEnd(9);
  let rest = "";
  const dec = new TextDecoder();
  for await (const chunk of stream) {
    const lines = (rest + dec.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop()!;
    for (const l of lines) console.log(tag, l);
  }
  if (rest) console.log(tag, rest);
}

console.log(`\n${urls.join("\n")}\n`);
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(children.map((c) => c.exited));
stop();
