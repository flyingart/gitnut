// macOS signing + notarization for build-desktop.ts, interactive like `eas build`:
// - the "Developer ID Application" certificate comes from your Keychain (a menu when there are
//   several; the choice can be saved to .env as APPLE_SIGNING_IDENTITY, which Tauri reads);
// - notarization uses a notarytool Keychain profile (GITNUT_NOTARY_PROFILE, default "gitnut-notary").
//   The first run offers to create it: Apple's own prompt asks for your Apple ID and an app-specific
//   password and stores them in the Keychain, never in this repo.
// Non-interactive (CI): set APPLE_SIGNING_IDENTITY and create the profile beforehand, or pass --no-notarize.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { ROOT, ask, confirm, interactive, ok, run } from "./lib";

export interface Signing {
  identity: string;
  team: string;
}

/** `Developer ID Application: Name (TEAMID)` entries of the login keychain. */
export function developerIds(): Signing[] {
  const out = run(["security", "find-identity", "-v", "-p", "codesigning"], { allowFail: true });
  return [...out.matchAll(/"(Developer ID Application: [^"]*\(([A-Z0-9]{10})\))"/g)].map((m) => ({ identity: m[1], team: m[2] }));
}

/** The signing identity to use, or null (unsigned build). Asks when there are several. */
export async function pickIdentity(): Promise<Signing | null> {
  const fromEnv = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (fromEnv) return { identity: fromEnv, team: /\(([A-Z0-9]{10})\)\s*$/.exec(fromEnv)?.[1] ?? process.env.APPLE_TEAM_ID ?? "" };
  const ids = developerIds();
  if (!ids.length) {
    console.warn('macOS: no "Developer ID Application" certificate in the Keychain, the app is not signed (Xcode > Settings > Accounts > Manage Certificates).');
    return null;
  }
  let pick = ids[0];
  if (ids.length > 1) {
    if (!interactive) throw new Error(`several Developer ID certificates; set APPLE_SIGNING_IDENTITY to one of:\n  ${ids.map((i) => i.identity).join("\n  ")}`);
    pick = await ask(p.select({ message: "Signing certificate", options: ids.map((i) => ({ value: i, label: i.identity })) }));
  }
  console.log(`macOS: signing with ${pick.identity}`);
  const envFile = join(ROOT, ".env");
  const saved = existsSync(envFile) && readFileSync(envFile, "utf8").includes("APPLE_SIGNING_IDENTITY=");
  if (interactive && !saved && (await confirm("Remember it in .env?"))) {
    appendFileSync(envFile, `\nAPPLE_SIGNING_IDENTITY="${pick.identity}"\n`);
  }
  return pick;
}

/** Name of a working notarytool Keychain profile, creating it interactively on first use; null = skip. */
export async function notaryProfile(team: string): Promise<string | null> {
  const name = process.env.GITNUT_NOTARY_PROFILE?.trim() || "gitnut-notary";
  if (ok(["xcrun", "notarytool", "history", "--keychain-profile", name])) return name;
  if (!interactive) {
    console.warn(`macOS: no notarytool profile "${name}", not notarizing (create it with: xcrun notarytool store-credentials ${name} --team-id ${team || "<TEAM>"}).`);
    return null;
  }
  if (!(await confirm("Notarize (needs your Apple ID + an app-specific password from appleid.apple.com, stored in the Keychain)?"))) return null;
  run(["xcrun", "notarytool", "store-credentials", name, ...(team ? ["--team-id", team] : [])], { live: true });
  return name;
}

/** Sign a binary with the hardened runtime (notarization requires it) and the Bun entitlements. */
export function signBinary(path: string, identity: string, entitlements: string) {
  if (!ok(["codesign", "--force", "--timestamp", "--options", "runtime", "--entitlements", entitlements, "--sign", identity, path], { live: true })) throw new Error(`codesign ${path} failed`);
}

/** Notarize and staple a .dmg (Gatekeeper then opens it without warnings, also offline). */
export function notarize(dmg: string, profile: string) {
  console.log(`macOS: notarizing ${dmg} (takes a few minutes)…`);
  if (!ok(["xcrun", "notarytool", "submit", dmg, "--keychain-profile", profile, "--wait"], { live: true })) throw new Error("notarization failed (see `xcrun notarytool log <id> --keychain-profile …`)");
  if (!ok(["xcrun", "stapler", "staple", dmg], { live: true })) throw new Error("stapling failed");
}
