// macOS signing + notarization for build-desktop.ts, interactive like `eas build`:
// - the "Developer ID Application" certificate comes from your Keychain (a menu when there are
//   several; the choice can be saved to .env as APPLE_SIGNING_IDENTITY, which Tauri reads);
// - notarization uses a notarytool Keychain profile (GITNUT_NOTARY_PROFILE, default "gitnut-notary").
//   The first run offers to create it: Apple's own prompt asks for your Apple ID and an app-specific
//   password and stores them in the Keychain, never in this repo.
// Non-interactive (CI): set APPLE_SIGNING_IDENTITY and create the profile beforehand, or pass --no-notarize.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const tty = process.stdin.isTTY && process.stdout.isTTY;

function sh(cmd: string[], live = false): { code: number; out: string } {
  const p = Bun.spawnSync(cmd, { stdio: live ? ["inherit", "inherit", "inherit"] : ["ignore", "pipe", "pipe"] });
  return { code: p.exitCode ?? 1, out: live ? "" : `${p.stdout}${p.stderr}` };
}

export interface Signing {
  identity: string;
  team: string;
}

/** `Developer ID Application: Name (TEAMID)` entries of the login keychain. */
export function developerIds(): Signing[] {
  const { out } = sh(["security", "find-identity", "-v", "-p", "codesigning"]);
  return [...out.matchAll(/"(Developer ID Application: [^"]*\(([A-Z0-9]{10})\))"/g)].map((m) => ({ identity: m[1], team: m[2] }));
}

/** The signing identity to use, or null (unsigned build). Asks when there are several. */
export function pickIdentity(root: string): Signing | null {
  const fromEnv = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (fromEnv) return { identity: fromEnv, team: /\(([A-Z0-9]{10})\)\s*$/.exec(fromEnv)?.[1] ?? process.env.APPLE_TEAM_ID ?? "" };
  const ids = developerIds();
  if (!ids.length) {
    console.warn('macOS: no "Developer ID Application" certificate in the Keychain, the app is not signed (Xcode > Settings > Accounts > Manage Certificates).');
    return null;
  }
  let pick = ids[0];
  if (ids.length > 1) {
    if (!tty) throw new Error(`several Developer ID certificates; set APPLE_SIGNING_IDENTITY to one of:\n  ${ids.map((i) => i.identity).join("\n  ")}`);
    console.log("Signing certificates:");
    ids.forEach((i, n) => console.log(`  ${n + 1}) ${i.identity}`));
    const n = Number(prompt(`Use which? [1-${ids.length}]`, "1"));
    pick = ids[n - 1] ?? ids[0];
  }
  console.log(`macOS: signing with ${pick.identity}`);
  const envFile = join(root, ".env");
  const saved = existsSync(envFile) && readFileSync(envFile, "utf8").includes("APPLE_SIGNING_IDENTITY=");
  if (tty && !saved && (prompt("Remember it in .env? [Y/n]", "y") ?? "y").toLowerCase().startsWith("y")) {
    appendFileSync(envFile, `\nAPPLE_SIGNING_IDENTITY="${pick.identity}"\n`);
  }
  return pick;
}

/** Name of a working notarytool Keychain profile, creating it interactively on first use; null = skip. */
export function notaryProfile(team: string): string | null {
  const name = process.env.GITNUT_NOTARY_PROFILE?.trim() || "gitnut-notary";
  if (sh(["xcrun", "notarytool", "history", "--keychain-profile", name]).code === 0) return name;
  if (!tty) {
    console.warn(`macOS: no notarytool profile "${name}", not notarizing (create it with: xcrun notarytool store-credentials ${name} --team-id ${team || "<TEAM>"}).`);
    return null;
  }
  if (!(prompt(`Notarize (needs your Apple ID + an app-specific password from appleid.apple.com, stored in the Keychain)? [Y/n]`, "y") ?? "y").toLowerCase().startsWith("y")) return null;
  const args = ["xcrun", "notarytool", "store-credentials", name, ...(team ? ["--team-id", team] : [])];
  if (sh(args, true).code !== 0) throw new Error("notarytool store-credentials failed");
  return name;
}

/** Sign a binary with the hardened runtime (notarization requires it) and the Bun entitlements. */
export function signBinary(path: string, identity: string, entitlements: string) {
  const r = sh(["codesign", "--force", "--timestamp", "--options", "runtime", "--entitlements", entitlements, "--sign", identity, path], true);
  if (r.code !== 0) throw new Error(`codesign ${path} failed`);
}

/** Notarize and staple a .dmg (Gatekeeper then opens it without warnings, also offline). */
export function notarize(dmg: string, profile: string) {
  console.log(`macOS: notarizing ${dmg} (takes a few minutes)…`);
  if (sh(["xcrun", "notarytool", "submit", dmg, "--keychain-profile", profile, "--wait"], true).code !== 0) throw new Error("notarization failed (see `xcrun notarytool log <id> --keychain-profile …`)");
  if (sh(["xcrun", "stapler", "staple", dmg], true).code !== 0) throw new Error("stapling failed");
}
