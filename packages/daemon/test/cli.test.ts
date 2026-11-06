import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { g, commit, tmp } from "./helpers";
import { parseArgs } from "../src/cli";
import { applyPatch, patchFromCli } from "../src/config";
import { DEFAULT_SETTINGS, type Settings } from "@gitnut/commons";

const CLI = join(import.meta.dir, "../src/cli.ts");
const home = tmp("gitnut-cli-");
const run = (args: string[], extraEnv: Record<string, string> = {}) => {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, GITNUT_HOME: home, ...extraEnv }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
};
const cfg = () => JSON.parse(readFileSync(join(home, "config.json"), "utf8"));

describe("cli", () => {
  test("R-DAEMON-1: version and --help for every command", () => {
    expect(run(["version"]).out).toMatch(/^\d+\.\d+\.\d+/);
    expect(run(["--help"]).out).toContain("Commands:");
    for (const c of ["serve", "status", "stop", "config", "token", "repos", "roots", "update", "service", "version"]) {
      const r = run([c, "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`gitnut ${c}`);
    }
    expect(run(["bogus"]).code).toBe(1);
  });

  test("R-DAEMON-6: config get/set validates types and writes config.json 0600", () => {
    expect(run(["config", "set", "port", "7999"]).code).toBe(0);
    expect(run(["config", "get", "port"]).out).toBe("7999");
    expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600);
    expect(run(["config", "set", "auth.enabled", "false"]).code).toBe(0);
    expect(cfg().settings.auth.enabled).toBe(false);
    run(["config", "set", "auth.enabled", "true"]);
    run(["config", "set", "allowedOrigins", '["https://a.example","https://b.example/"]']);
    expect(cfg().settings.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    run(["config", "set", "exclude", "node_modules, dist"]);
    expect(cfg().settings.exclude).toEqual(["node_modules", "dist"]);
    expect(run(["config", "set", "update.manifestUrl", "https://evil.example/m.json"]).code).toBe(1); // not a setting
    expect(run(["config", "set", "port", "abc"]).code).toBe(1);
    expect(run(["config", "set", "serveWeb", "maybe"]).code).toBe(1);
    expect(run(["config", "set", "bind", "somewhere"]).code).toBe(1);
    expect(run(["config", "set", "nope", "1"]).err).toContain("unknown key");
    expect(run(["config", "get", "auth.token"]).code).toBe(1);
    expect(JSON.stringify(run(["config", "get"]).out)).not.toContain(cfg().settings.auth.token);
  });

  test("R-DAEMON-5: disabling auth on a public bind needs --force", () => {
    run(["config", "set", "auth.enabled", "false"]);
    const r = run(["config", "set", "bind", "all"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--force");
    expect(run(["config", "set", "bind", "all", "--force"]).code).toBe(0);
    run(["config", "set", "bind", "localhost"]);
    run(["config", "set", "auth.enabled", "true"]);
  });

  test("R-DAEMON-6: token and token --rotate", () => {
    const t = run(["token"]).out;
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const t2 = run(["token", "--rotate"]).out;
    expect(t2).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t2).not.toBe(t);
    expect(run(["token"]).out).toBe(t2);
  });

  test("R-DAEMON-6: repos and roots add/list/remove", () => {
    const dir = tmp();
    const repo = join(dir, "proj");
    mkdirSync(repo);
    g(repo, "init", "-q");
    commit(repo, "c", { "f.txt": "1" });
    expect(run(["roots", "add", dir]).code).toBe(0);
    expect(run(["roots", "list"]).out).toBe(dir);
    expect(run(["repos", "list"]).out).toContain(`proj  ${repo}`);
    expect(run(["roots", "remove", dir]).code).toBe(0);
    expect(run(["roots", "list"]).out).toBe("no roots");
    expect(run(["repos", "add", repo]).code).toBe(0);
    const list = JSON.parse(run(["repos", "list", "--json"]).out);
    expect(list[0]).toMatchObject({ name: "proj", path: repo, root: null });
    expect(run(["repos", "add", tmp()]).code).toBe(1);
    run(["repos", "remove", repo]);
    expect(cfg().settings.repos).toEqual([]);
    expect(run(["roots", "add", join(dir, "missing")]).code).toBe(1);
  });

  test("R-DAEMON-6: status --json when not running", () => {
    run(["config", "set", "port", "7999"]);
    expect(JSON.parse(run(["status", "--json"]).out)).toEqual({ running: false, url: "http://127.0.0.1:7999", version: expect.any(String), name: expect.any(String) });
  });

  test("R-UPD-2: update --check without a manifest URL", () => {
    const r = run(["update", "--check"], { GITNUT_MANIFEST_URL: "" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("updates are off");
  });

  test("R-DAEMON-9: service install / status / uninstall write the unit (dry run)", () => {
    const dir = tmp();
    const e = { GITNUT_SERVICE_DIR: dir, GITNUT_SERVICE_DRY: "1" };
    const r = run(["service", "install"], e);
    expect(r.code).toBe(0);
    expect(r.out).toContain("(dry run) systemctl --user enable --now gitnut.service");
    const unit = readFileSync(join(dir, "gitnut.service"), "utf8");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("Environment=GITNUT_SERVICE=1");
    expect(unit).toContain(`Environment=GITNUT_HOME=${home}`);
    expect(unit).toMatch(/ExecStart=.*cli\.ts serve/);
    expect(run(["service", "status"], e).out).toContain("installed");
    expect(run(["service", "uninstall"], e).code).toBe(0);
    expect(existsSync(join(dir, "gitnut.service"))).toBe(false);
    expect(run(["service", "status"], e).out).toBe("not installed");
  });
});

describe("cli with a running daemon", () => {
  let proc: ReturnType<typeof Bun.spawn>;
  beforeAll(() => {
    proc = Bun.spawn(["bun", CLI, "serve", "--port", "0", "--no-web"], { env: { ...process.env, GITNUT_HOME: home }, stdout: "ignore", stderr: "inherit" });
  });
  afterAll(() => proc.kill());

  const status = async () => {
    for (let i = 0; i < 100; i++) {
      const s = JSON.parse(run(["status", "--json"]).out);
      if (s.running) return s;
      await Bun.sleep(100);
    }
    throw new Error("daemon did not start");
  };

  test("R-DAEMON-6: status, live config changes, rotation and stop", async () => {
    const s = await status();
    expect([s.running, s.pid]).toEqual([true, proc.pid]);
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(s.url).not.toEndWith(":7999"); // --port 0 overrides the setting for this run
    expect((await fetch(`${s.url}/`)).status).toBe(404); // --no-web

    expect(run(["config", "set", "name", "cli-box"]).code).toBe(0);
    expect((await (await fetch(`${s.url}/api/health`)).json()).name).toBe("cli-box");

    const old = run(["token"]).out;
    const fresh = run(["token", "--rotate"]).out;
    expect(fresh).not.toBe(old);
    const rpc = (t: string) =>
      fetch(`${s.url}/api/rpc`, { method: "POST", headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ method: "settings.get" }) });
    expect((await rpc(old)).status).toBe(401);
    expect((await rpc(fresh)).status).toBe(200);

    // Restart keys restart the listener.
    const port = 20000 + Math.floor(Math.random() * 20000);
    expect(run(["config", "set", "port", String(port)]).out).toContain("restarted");
    await Bun.sleep(800);
    expect(JSON.parse(run(["status", "--json"]).out).url).toBe(`http://127.0.0.1:${port}`);

    expect(run(["stop"]).out).toBe("stopped");
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(run(["status", "--json"]).out).running).toBe(false);
  }, 20_000);
});

test("R-DAEMON-6: arg parser and settings validation", () => {
  expect(parseArgs(["serve", "--port", "0", "--bind=all", "--no-web"])).toEqual({ pos: ["serve"], flags: { port: "0", bind: "all", "no-web": true } });
  const s = { ...structuredClone(DEFAULT_SETTINGS), auth: { enabled: true, token: "t".repeat(43) } } as Settings;
  expect(patchFromCli("roots", "a,b").roots).toHaveLength(2);
  expect(applyPatch(s, { port: 8000 }).restartRequired).toBe(true);
  expect(applyPatch(s, { name: "x" }).restartRequired).toBe(false);
  expect(() => applyPatch(s, { scanDepth: -1 })).toThrow();
  expect(() => applyPatch(s, { pollIntervalMs: 10 })).toThrow();
  expect(() => applyPatch(s, { bind: "10.0.0.1", auth: { enabled: false } })).toThrow("force");
  expect(applyPatch(s, { bind: "tailscale", auth: { enabled: false } }).settings.auth.enabled).toBe(false);
  expect(applyPatch(s, { bind: "10.0.0.1", auth: { enabled: false } }, true).settings.bind).toBe("10.0.0.1");
});
