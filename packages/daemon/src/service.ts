import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IS_COMPILED } from "./version";

// GITNUT_SERVICE_DIR moves the unit / plist (tests); GITNUT_SERVICE_DRY=1 skips systemctl / launchctl / schtasks.
const LABEL = "dev.gitnut.daemon";
const TASK = "gitnut";

/** Command that starts the daemon: the binary, or bun + cli.ts when running from source. */
export function serveCommand(): string[] {
  return IS_COMPILED ? [process.execPath, "serve"] : [process.execPath, Bun.main, "serve"];
}

function run(cmd: string[], log: (s: string) => void): boolean {
  if (process.env.GITNUT_SERVICE_DRY) {
    log(`(dry run) ${cmd.join(" ")}`);
    return true;
  }
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = `${r.stdout.toString()}${r.stderr.toString()}`.trim();
  if (out) log(out);
  return r.exitCode === 0;
}


export function unitPath(): string {
  if (process.platform === "darwin") {
    return join(process.env.GITNUT_SERVICE_DIR ?? join(homedir(), "Library/LaunchAgents"), `${LABEL}.plist`);
  }
  return join(process.env.GITNUT_SERVICE_DIR ?? join(homedir(), ".config/systemd/user"), "gitnut.service");
}

export function systemdUnit(cmd: string[], vars: Record<string, string>): string {
  const q = (s: string) => (/[\s"\\]/.test(s) ? `"${s.replace(/["\\]/g, "\\$&")}"` : s);
  return `[Unit]
Description=gitnut daemon (git state for gitnut clients)
After=network-online.target

[Service]
ExecStart=${cmd.map(q).join(" ")}
Restart=always
RestartSec=3
Environment=GITNUT_SERVICE=1
${Object.entries(vars)
  .map(([k, v]) => `Environment=${q(`${k}=${v}`)}`)
  .join("\n")}

[Install]
WantedBy=default.target
`;
}

export function launchdPlist(cmd: string[], vars: Record<string, string>, logFile: string): string {
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const envXml = Object.entries({ GITNUT_SERVICE: "1", ...vars })
    .map(([k, v]) => `<key>${x(k)}</key><string>${x(v)}</string>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${cmd.map((c) => `<string>${x(c)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict>${envXml}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${x(logFile)}</string>
<key>StandardErrorPath</key><string>${x(logFile)}</string>
</dict></plist>
`;
}

export function installService(home: string, log: (s: string) => void): boolean {
  const cmd = serveCommand();
  if (process.platform === "win32") {
    // A logon task; restarts after updates are done by the daemon itself (spawns the new binary).
    const tr = cmd.map((c) => `"${c}"`).join(" ");
    return run(["schtasks", "/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", TASK, "/TR", tr], log) && run(["schtasks", "/Run", "/TN", TASK], log);
  }
  const file = unitPath();
  mkdirSync(join(file, ".."), { recursive: true });
  if (process.platform === "darwin") {
    writeFileSync(file, launchdPlist(cmd, { GITNUT_HOME: home }, join(home, "daemon.log")));
    log(`wrote ${file}`);
    run(["launchctl", "unload", file], () => {});
    return run(["launchctl", "load", "-w", file], log);
  }
  writeFileSync(file, systemdUnit(cmd, { GITNUT_HOME: home }));
  log(`wrote ${file}`);
  return run(["systemctl", "--user", "daemon-reload"], log) && run(["systemctl", "--user", "enable", "--now", "gitnut.service"], log);
}

export function uninstallService(log: (s: string) => void): boolean {
  if (process.platform === "win32") return run(["schtasks", "/Delete", "/F", "/TN", TASK], log);
  const file = unitPath();
  if (process.platform === "darwin") run(["launchctl", "unload", "-w", file], log);
  else run(["systemctl", "--user", "disable", "--now", "gitnut.service"], log);
  if (existsSync(file)) {
    rmSync(file);
    log(`removed ${file}`);
  }
  if (process.platform !== "darwin") run(["systemctl", "--user", "daemon-reload"], log);
  return true;
}

export function serviceStatus(log: (s: string) => void): boolean {
  if (process.platform === "win32") return run(["schtasks", "/Query", "/TN", TASK], log);
  const file = unitPath();
  if (!existsSync(file)) {
    log("not installed");
    return false;
  }
  log(`installed: ${file}`);
  return process.platform === "darwin" ? run(["launchctl", "list", LABEL], log) : run(["systemctl", "--user", "is-active", "gitnut.service"], log);
}
