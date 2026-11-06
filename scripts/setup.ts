#!/usr/bin/env bun
// Prepare this machine for building and releasing GitNut. Safe to run again any time:
//   bun run setup
// Checks the tools, the GitHub login, and .env (GITNUT_SITE_URL, the desktop updater key), and
// offers to fix what is missing. Prints install hints for anything it can't do itself.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { ROOT, ask, confirm, has, ok, run } from "./lib";

const ENV = join(ROOT, ".env");
const mac = process.platform === "darwin";
const win = process.platform === "win32";

/** Trimmed stdout, "" when the command is missing or fails. */
const out = (cmd: string[]) => {
  try {
    return run(cmd);
  } catch {
    return "";
  }
};

function readEnv(): Record<string, string> {
  if (!existsSync(ENV)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(ENV, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return vars;
}
function setEnv(key: string, value: string) {
  const text = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const line = `${key}=${value}`;
  const next = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(ENV, next);
}

interface Check {
  name: string;
  ok: boolean;
  hint?: string;
}
const results: Check[] = [];
const check = (name: string, pass: boolean, hint?: string) => results.push({ name, ok: pass, hint });

async function main() {
  p.intro("GitNut build machine setup");

  // 1. tools
  check("bun", true);
  check("git", has("git"), "install git");
  check("gh (GitHub CLI)", has("gh"), mac ? "brew install gh" : win ? "winget install GitHub.cli" : "https://cli.github.com");
  if (has("gh") && !ok(["gh", "auth", "status"])) {
    if (await confirm("gh is not logged in. Log in now?")) ok(["gh", "auth", "login"], { live: true });
  }
  check("gh logged in", has("gh") && ok(["gh", "auth", "status"]), "gh auth login");
  const cargo = has("cargo") || existsSync(join(homedir(), ".cargo", "bin", win ? "cargo.exe" : "cargo"));
  check("Rust (cargo), for desktop builds", cargo, "https://rustup.rs");
  if (mac) {
    check("Xcode command line tools", ok(["xcode-select", "-p"]), "xcode-select --install");
    const targets = out(["rustup", "target", "list", "--installed"]);
    check("Rust target x86_64-apple-darwin (Intel build)", targets.includes("x86_64-apple-darwin"), "rustup target add x86_64-apple-darwin");
    check("Windows cross-build: cargo-xwin + nsis (optional)", has("cargo-xwin") && has("makensis"), "brew install nsis llvm; rustup target add x86_64-pc-windows-msvc; cargo install --locked cargo-xwin");
    const ids = out(["security", "find-identity", "-v", "-p", "codesigning"]);
    check("Developer ID certificate (optional, signs the macOS app)", ids.includes("Developer ID Application"), "Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application");
    if (ids.includes("Developer ID Application")) {
      const profile = process.env.GITNUT_NOTARY_PROFILE || "gitnut-notary";
      check(`Notarization profile "${profile}" (optional)`, ok(["xcrun", "notarytool", "history", "--keychain-profile", profile]), `xcrun notarytool store-credentials ${profile} --team-id <TEAM_ID>`);
    }
  }

  // 2. .env: where shipped binaries look for updates
  const env = readEnv();
  if (!env.GITNUT_SITE_URL) {
    const url = await ask(
      p.text({
        message: "Website of your GitNut releases (GITNUT_SITE_URL): shipped binaries check <site>/manifest.json for updates",
        placeholder: "https://gitnut.dev",
        initialValue: "https://gitnut.dev",
        validate: (v) => (/^https?:\/\/\S+$/.test(v ?? "") ? undefined : "an http(s) URL"),
      }),
    );
    setEnv("GITNUT_SITE_URL", url.replace(/\/+$/, ""));
  }
  check("GITNUT_SITE_URL in .env", !!readEnv().GITNUT_SITE_URL);

  // 3. desktop updater key: signs desktop updates, the public half is in tauri.conf.json
  let key = readEnv().TAURI_SIGNING_PRIVATE_KEY?.replace(/^~(?=\/)/, homedir());
  if (!key || !existsSync(key)) {
    const where = join(homedir(), ".tauri", "gitnut.key");
    const choice = await ask(
      p.select({
        message: "Desktop updater key (TAURI_SIGNING_PRIVATE_KEY): needed for desktop builds",
        options: [
          { value: "existing", label: "I have the key file", hint: "copy it from your password manager or the first build machine" },
          { value: "new", label: "Create a new key", hint: "only for a fork: apps signed with the old key can't update to it" },
          { value: "skip", label: "Skip (CLI builds only)" },
        ],
      }),
    );
    if (choice === "existing") {
      key = await ask(p.text({ message: "Path of the key file", initialValue: where, validate: (v) => (existsSync((v ?? "").replace(/^~(?=\/)/, homedir())) ? undefined : "file not found") }));
      key = key.replace(/^~(?=\/)/, homedir());
    } else if (choice === "new") {
      mkdirSync(dirname(where), { recursive: true });
      Bun.spawnSync(["bunx", "tauri", "signer", "generate", "-w", where, "-p", "", "--ci"], { cwd: join(ROOT, "packages", "desktop"), stdio: ["ignore", "ignore", "inherit"] });
      if (!win) chmodSync(where, 0o600);
      key = where;
      const pub = readFileSync(`${where}.pub`, "utf8").trim();
      p.note(`Put this public key into packages/desktop/src-tauri/tauri.conf.json (plugins.updater.pubkey):\n${pub}\n\nBack up ${where} in your password manager.`, "New updater key");
    }
    if (key && existsSync(key)) {
      setEnv("TAURI_SIGNING_PRIVATE_KEY", key);
      if (readEnv().TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) setEnv("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "");
    }
  }
  check("Desktop updater key", !!key && existsSync(key), "run `bun run setup` again once you have the key file");

  // 4. summary
  const lines = results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name}${r.ok || !r.hint ? "" : `\n    ${r.hint}`}`);
  p.note(lines.join("\n"), "This machine");
  const required = results.filter((r) => !r.ok && !r.name.includes("optional"));
  p.outro(required.length ? "Fix the ✗ items above, then run `bun run setup` again." : "Ready. Next: `bun run release`.");
}

main().catch((e) => {
  p.log.error(e.message);
  process.exit(1);
});
