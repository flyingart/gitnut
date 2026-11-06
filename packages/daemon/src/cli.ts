#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { toPublicSettings, type RepoSummary, type SettingsPatch } from "@gitnut/commons";
import { applyPatch, getKey, homeDir, loadConfig, patchFromCli, repoPatch, rootPatch, saveConfig } from "./config";
import { GitnutError } from "./errors";
import { localHost, resolveBind, urlHost } from "./net";
import { discover, repoSummaries } from "./repos";
import { Daemon, daemonFile, type DaemonFile, type Overrides } from "./server";
import { installService, serviceStatus, uninstallService } from "./service";
import { applyUpdate, checkUpdate } from "./update";
import { VERSION } from "./version";

const HELP: Record<string, string> = {
  main: `gitnut ${VERSION} - remote-first git client daemon

Usage: gitnut <command> [options]

Commands:
  serve                 Run the daemon in the foreground
  status [--json]       Is a daemon running, and where
  stop                  Stop the running daemon
  config get|set        Read or change settings
  token [--rotate]      Print (or rotate) the access token
  repos list|add|remove Explicit repositories
  roots list|add|remove Folders scanned for repositories
  update [--check]      Update this binary (and the web client it serves)
  service install|uninstall|status   Run gitnut as a user service
  version               Print the version

Global options:
  --home DIR            Config folder (default: $GITNUT_HOME or ~/.gitnut)
  -h, --help            Help for a command (gitnut <command> --help)`,
  serve: `Usage: gitnut serve [--port N] [--bind localhost|tailscale|all|<ip>] [--no-web] [--force]

Run the daemon in the foreground. Flags override settings for this run only.
  --port N      Port (0 = random free port)
  --bind MODE   localhost (default), tailscale (this machine's Tailscale IP), all, or an IP
  --no-web      Don't serve the web client at /
  --force       Allow auth turned off on a public bind`,
  status: `Usage: gitnut status [--json]

Show whether a daemon is running. --json prints {running, url, version, name, pid?};
url is the address a client on this machine can open.`,
  stop: `Usage: gitnut stop

Ask the running daemon to shut down (authenticated with the local token).`,
  config: `Usage: gitnut config get [key]
       gitnut config set <key> <value> [--force]

Keys use dots: name, port, bind, serveWeb, roots, repos, exclude, scanDepth, pollIntervalMs, autoFetchMinutes,
hideInternalRefs, allowedOrigins, auth.enabled, update.autoCheck.
Lists take JSON (["a","b"]) or a comma list (a,b). A running daemon applies changes at once.
Turning auth off on a public bind needs --force.`,
  token: `Usage: gitnut token [--rotate]

Print the access token. --rotate makes a new one and disconnects sessions using the old one.`,
  repos: `Usage: gitnut repos list [--json]
       gitnut repos add <path>
       gitnut repos remove <path>

Explicit repositories. Removing a repo found under a root excludes it.`,
  roots: `Usage: gitnut roots list
       gitnut roots add <dir>
       gitnut roots remove <dir>

Folders scanned (to scanDepth levels) for git repositories.`,
  update: `Usage: gitnut update [--check]

Download the latest binary for this platform, verify its SHA-256 and replace this binary.
A running daemon updates itself and restarts. --check only reports whether an update exists.`,
  service: `Usage: gitnut service install|uninstall|status

Run the daemon as a user service: systemd user unit on Linux
(~/.config/systemd/user/gitnut.service), launchd agent on macOS
(~/Library/LaunchAgents/dev.gitnut.daemon.plist), a logon task on Windows.`,
  version: `Usage: gitnut version

Print the version.`,
};

const VALUE_FLAGS = new Set(["port", "bind", "home"]);

export function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") flags.help = true;
    else if (a === "--") pos.push(...argv.slice(i + 1)), (i = argv.length);
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = a.slice(2, eq > 0 ? eq : undefined);
      if (eq > 0) flags[name] = a.slice(eq + 1);
      else if (VALUE_FLAGS.has(name)) {
        if (i + 1 >= argv.length) throw new GitnutError("bad_request", `--${name} needs a value`);
        flags[name] = argv[++i];
      } else flags[name] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const out = (s: unknown) => console.log(typeof s === "string" ? s : JSON.stringify(s, null, 2));

/** The daemon of this config dir if it runs and answers. */
async function running(home: string): Promise<DaemonFile | null> {
  const file = daemonFile(home);
  if (!existsSync(file)) return null;
  try {
    const info = JSON.parse(readFileSync(file, "utf8")) as DaemonFile;
    process.kill(info.pid, 0);
    const res = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? info : null;
  } catch {
    return null;
  }
}

async function rpc(home: string, d: DaemonFile, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${d.url}/api/rpc`, {
    method: "POST",
    headers: { authorization: `Bearer ${loadConfig(home).settings.auth.token}`, "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { code: any; message: string } };
  if (body.error) throw new GitnutError(body.error.code, body.error.message);
  return body.result;
}

/** Apply a settings patch through the running daemon, or to the config file. */
async function patchSettings(home: string, patch: SettingsPatch, force: boolean) {
  const d = await running(home);
  if (d) return (await rpc(home, d, "settings.update", { patch, force })) as { token?: string; restartRequired: boolean };
  const cfg = loadConfig(home);
  const r = applyPatch(cfg.settings, patch, force);
  cfg.settings = r.settings;
  saveConfig(home, cfg);
  return r;
}

function printRepos(list: RepoSummary[]) {
  if (!list.length) return out("no repositories (add some with `gitnut roots add <dir>` or `gitnut repos add <path>`)");
  for (const r of list) {
    out(`${r.name}  ${r.path}${r.root ? "" : "  (explicit)"}`);
    for (const w of r.worktrees) {
      const c = w.counts;
      const dirty = c.staged + c.unstaged + c.untracked + c.conflicted;
      out(`  ${w.isMain ? "*" : "-"} ${w.branch ?? "(detached)"}  ${w.path}${dirty ? `  ${dirty} changed` : ""}${w.ahead || w.behind ? `  +${w.ahead}/-${w.behind}` : ""}`);
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  const { pos, flags } = parseArgs(argv);
  const [cmd = "", sub] = pos;
  if (typeof flags.home === "string") process.env.GITNUT_HOME = resolve(flags.home);
  if (flags.help || cmd === "help" || !cmd) {
    out(HELP[(cmd === "help" ? sub : cmd) ?? ""] ?? HELP.main);
    return cmd || flags.help ? 0 : 1;
  }
  const home = homeDir();
  const force = flags.force === true;

  switch (cmd) {
    case "version":
      out(VERSION);
      return 0;

    case "serve": {
      const overrides: Overrides = {};
      if (flags.port !== undefined) overrides.port = Number(flags.port);
      if (typeof flags.bind === "string") overrides.bind = flags.bind;
      if (flags["no-web"]) overrides.serveWeb = false;
      if (overrides.port !== undefined && !(Number.isInteger(overrides.port) && overrides.port >= 0 && overrides.port < 65536)) {
        throw new GitnutError("bad_request", "--port must be 0..65535");
      }
      if (await running(home)) throw new GitnutError("conflict", `a daemon for ${home} is already running (gitnut status)`);
      const d = new Daemon({ home, overrides, force });
      await d.start();
      const stop = () => void d.stop();
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await d.stopped;
      return 0;
    }

    case "status": {
      const d = await running(home);
      const s = loadConfig(home).settings;
      let url = d?.url ?? "";
      if (!d) {
        try {
          url = `http://${urlHost(localHost(resolveBind(s.bind)))}:${s.port}`;
        } catch {}
      }
      const health = d ? ((await (await fetch(`${d.url}/api/health`)).json()) as { name: string; version: string }) : null;
      const status = { running: !!d, url, version: health?.version ?? VERSION, name: health?.name ?? (s.name || hostname()), ...(d ? { pid: d.pid } : {}) };
      if (flags.json) out(JSON.stringify(status));
      else out(d ? `running (pid ${d.pid}) at ${url}, version ${status.version}` : "not running");
      return 0;
    }

    case "stop": {
      const d = await running(home);
      if (!d) return out("not running"), 0;
      const res = await fetch(`${d.url}/api/stop`, {
        method: "POST",
        headers: { authorization: `Bearer ${loadConfig(home).settings.auth.token}` },
      });
      if (!res.ok) throw new GitnutError("unauthorized", `stop refused: HTTP ${res.status}`);
      for (let i = 0; i < 50 && (await running(home)); i++) await Bun.sleep(100);
      out("stopped");
      return 0;
    }

    case "config": {
      if (sub === "get") {
        const s = loadConfig(home).settings;
        const key = pos[2];
        out(key ? getKey(s, key) : toPublicSettings(s));
        return 0;
      }
      if (sub === "set") {
        const [key, value] = [pos[2], pos[3]];
        if (!key || value === undefined) throw new GitnutError("bad_request", HELP.config);
        const r = await patchSettings(home, patchFromCli(key, value), force);
        const s = loadConfig(home).settings;
        out(`${key} = ${JSON.stringify(getKey(s, key))}${r.restartRequired ? " (listener restarted)" : ""}`);
        if (!s.auth.enabled && s.bind !== "localhost" && !s.bind.startsWith("127."))
          console.error(`warning: auth is off and the daemon listens on ${s.bind}: anyone who can reach it has full access. Turn it on with \`gitnut config set auth.enabled true\`.`);
        return 0;
      }
      out(HELP.config);
      return 1;
    }

    case "token": {
      if (flags.rotate) {
        const r = await patchSettings(home, { auth: { rotateToken: true } }, false);
        out(r.token ?? loadConfig(home).settings.auth.token);
      } else out(loadConfig(home).settings.auth.token);
      return 0;
    }

    case "repos": {
      const d = await running(home);
      if (sub === "list" || !sub) {
        const list: RepoSummary[] = d ? await rpc(home, d, "repos.list") : await repoSummaries(await discover(loadConfig(home).settings));
        if (flags.json) out(list);
        else printRepos(list);
        return 0;
      }
      if (sub !== "add" && sub !== "remove") return out(HELP.repos), 1;
      const path = pos[2] ?? "";
      if (d) await rpc(home, d, `repos.${sub}`, { path });
      else await patchSettings(home, repoPatch(loadConfig(home).settings, sub, path), false);
      out(`${sub === "add" ? "added" : "removed"} ${resolve(path)}`);
      return 0;
    }

    case "roots": {
      const roots = loadConfig(home).settings.roots;
      if (sub === "list" || !sub) return out(roots.length ? roots.join("\n") : "no roots"), 0;
      if ((sub !== "add" && sub !== "remove") || !pos[2]) return out(HELP.roots), 1;
      const dir = resolve(pos[2]);
      await patchSettings(home, rootPatch(loadConfig(home).settings, sub, dir), false);
      out(`${sub === "add" ? "added" : "removed"} root ${dir}`);
      return 0;
    }

    case "update": {
      const d = await running(home);
      if (flags.check) {
        const info = d ? await rpc(home, d, "update.check") : await checkUpdate(loadConfig(home).settings);
        const { manifest, ...shown } = info;
        if (flags.json) out(shown);
        else if (info.error) out(`update check failed: ${info.error}`);
        else out(info.available ? `update available: ${info.current} -> ${info.latest}` : `up to date (${info.current})`);
        return info.error ? 1 : 0;
      }
      if (d) {
        const r = await rpc(home, d, "update.apply");
        out(`updated to ${r.version}, daemon restarting`);
      } else out(`updated to ${await applyUpdate(loadConfig(home).settings)}`);
      return 0;
    }

    case "service": {
      const log = (s: string) => out(s);
      if (sub === "install") return installService(home, log) ? 0 : 1;
      if (sub === "uninstall") return uninstallService(log) ? 0 : 1;
      if (sub === "status") return serviceStatus(log) ? 0 : 1;
      out(HELP.service);
      return 1;
    }
  }
  out(`unknown command ${cmd}\n\n${HELP.main}`);
  return 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`gitnut: ${e instanceof GitnutError ? e.message : (e as Error).stack ?? e}`);
      process.exit(1);
    },
  );
}
