import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type BrowseResult, type DiscoverResult, type RepoSummary } from "@gitnut/commons";
import { loadConfig } from "../src/config";
import { Client, bearer, commit, g, makeFixture, startDaemon, tmp, type Fixture } from "./helpers";

let fx: Fixture;
let env: Awaited<ReturnType<typeof startDaemon>>;
let c: Client;
let extra: string;

beforeAll(async () => {
  fx = makeFixture();
  // a second folder with two repos that is not watched
  extra = tmp("gitnut-extra-");
  for (const name of ["one", "two"]) {
    mkdirSync(join(extra, name));
    g(join(extra, name), "init", "-q", "-b", "main");
    commit(join(extra, name), "init", { "README.md": name });
  }
  env = await startDaemon();
  c = await Client.connect(env.wsUrl, bearer(env.token));
});
afterAll(async () => {
  c?.close();
  await env?.d.stop();
});

const names = (list: RepoSummary[]) => list.map((r) => r.name).sort();

describe("projects", () => {
  test("R-DAEMON-5: fresh config has auth off and binds to localhost", () => {
    const cfg = loadConfig(tmp("gitnut-fresh-"));
    expect(cfg.settings.auth.enabled).toBe(false);
    expect(cfg.settings.bind).toBe("localhost");
    expect(DEFAULT_SETTINGS.auth.enabled).toBe(false);
    expect(cfg.settings.auth.token.length).toBeGreaterThan(30); // ready for when auth is turned on
  });

  test("R-DAEMON-7: fs.browse lists sub-folders and marks repos", async () => {
    const r = await c.call<BrowseResult>("fs.browse", { path: extra });
    expect(r.path).toBe(extra);
    expect(r.parent).not.toBeNull();
    expect(r.dirs.map((d) => [d.name, d.repo])).toEqual([["one", true], ["two", true]]);
    expect((await c.call<BrowseResult>("fs.browse", {})).path).toBe(r.home);
    expect((await c.send("fs.browse", { path: join(extra, "missing") })).error.code).toBe("not_found");
  });

  test("R-DAEMON-7: add single projects, then a whole folder", async () => {
    let d = await c.call<DiscoverResult>("repos.discover", { path: extra });
    expect(d.watchedBy).toBeNull();
    expect(d.repos.map((r) => [r.name, r.added])).toEqual([["one", false], ["two", false]]);

    expect(names(await c.call<RepoSummary[]>("repos.add", { path: join(extra, "one") }))).toEqual(["one"]);
    d = await c.call<DiscoverResult>("repos.discover", { path: extra });
    expect(d.repos.map((r) => r.added)).toEqual([true, false]);

    // watching the fixture root brings its repo in too
    const list = await c.call<RepoSummary[]>("roots.add", { path: fx.root });
    expect(list.length).toBe(2);
    expect((await c.call<DiscoverResult>("repos.discover", { path: fx.root })).watchedBy).toBe(fx.root);
    expect((await c.call<DiscoverResult>("repos.discover", { path: join(fx.root, "alpha") })).watchedBy).toBe(fx.root);
    expect((await c.send("roots.add", { path: join(extra, "nope") })).error.code).toBe("bad_request");
  });

  test("R-DAEMON-7: removing a repo from a watched folder hides it; adding it back un-hides it", async () => {
    const before = await c.call<RepoSummary[]>("repos.list");
    const watchedRepo = before.find((r) => r.path.startsWith(fx.root))!;
    let list = await c.call<RepoSummary[]>("repos.remove", { path: watchedRepo.path });
    expect(list.find((r) => r.id === watchedRepo.id)).toBeUndefined();
    expect(env.d.cfg.settings.exclude).toContain(watchedRepo.path);
    // discover still shows it (not added), so the picker can bring it back
    const d = await c.call<DiscoverResult>("repos.discover", { path: fx.root });
    expect(d.repos.some((r) => r.path === watchedRepo.path && !r.added)).toBe(true);
    list = await c.call<RepoSummary[]>("repos.add", { path: watchedRepo.path });
    expect(list.some((r) => r.id === watchedRepo.id)).toBe(true);
    expect(env.d.cfg.settings.exclude).not.toContain(watchedRepo.path);
  });

  test("R-DAEMON-7: an explicit repo inside a watched folder stays hidden after remove", async () => {
    const list = await c.call<RepoSummary[]>("repos.list");
    const r = list.find((x) => x.path.startsWith(fx.root))!;
    await c.call("repos.remove", { path: r.path });
    expect(env.d.cfg.settings.repos).not.toContain(r.path);
    expect((await c.call<RepoSummary[]>("repos.list")).some((x) => x.id === r.id)).toBe(false);
  });

  test("R-DAEMON-7: roots.remove stops watching", async () => {
    const list = await c.call<RepoSummary[]>("roots.remove", { path: fx.root });
    expect(env.d.cfg.settings.roots).not.toContain(fx.root);
    expect(names(list)).toEqual(["one"]);
  });
});

test("R-DAEMON-7: bare repositories are found too", async () => {
  const base = tmp("gitnut-bare-");
  g(base, "init", "-q", "--bare", "srv.git");
  const b = await c.call<BrowseResult>("fs.browse", { path: base });
  expect(b.dirs).toEqual([{ name: "srv.git", path: join(base, "srv.git"), repo: true }]);
  const d = await c.call<DiscoverResult>("repos.discover", { path: base });
  expect(d.repos.map((r) => r.name)).toEqual(["srv.git"]);
});
