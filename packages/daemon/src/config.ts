import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS, RESTART_KEYS, isPublicBind, type Settings, type SettingsPatch } from "@gitnut/commons";
import { fail } from "./errors";

export interface Config {
  /** Stable server id. */
  id: string;
  settings: Settings;
}

export const homeDir = (override?: string) => resolve(override ?? process.env.GITNUT_HOME ?? join(homedir(), ".gitnut"));
export const configPath = (home: string) => join(home, "config.json");
export const newToken = () => randomBytes(32).toString("base64url");

export function loadConfig(home: string): Config {
  const file = configPath(home);
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const s = raw.settings ?? {};
  const cfg: Config = {
    id: raw.id || randomUUID(),
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      auth: { enabled: s.auth?.enabled ?? DEFAULT_SETTINGS.auth.enabled, token: s.auth?.token || newToken() },
      update: { ...DEFAULT_SETTINGS.update, ...s.update },
    },
  };
  if (!raw.id || !s.auth?.token) saveConfig(home, cfg);
  return cfg;
}

export function saveConfig(home: string, cfg: Config) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = configPath(home);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

const expandHome = (p: string) => resolve(p.replace(/^~(?=$|[\\/])/, homedir()));

type Kind = "string" | "number" | "boolean" | "list";
interface KeyDef {
  kind: Kind;
  /** Returns the normalized value or throws via `fail`. */
  check?: (v: any) => unknown;
}

const int = (min: number, max: number) => (v: number) =>
  Number.isInteger(v) && v >= min && v <= max ? v : fail("bad_request", `must be an integer ${min}..${max}`);
const paths = (v: string[]) => [...new Set(v.map(expandHome))];

/** Every settable key (dot notation). `auth.token` is changed only by rotation. */
export const KEYS: Record<string, KeyDef> = {
  name: { kind: "string" },
  port: { kind: "number", check: int(0, 65535) },
  bind: {
    kind: "string",
    check: (v: string) =>
      ["localhost", "tailscale", "all"].includes(v) || isIP(v) ? v : fail("bad_request", "must be localhost, tailscale, all or an IP"),
  },
  serveWeb: { kind: "boolean" },
  roots: { kind: "list", check: paths },
  repos: { kind: "list", check: paths },
  exclude: { kind: "list" },
  scanDepth: { kind: "number", check: int(0, 20) },
  pollIntervalMs: { kind: "number", check: int(250, 3_600_000) },
  autoFetchMinutes: {
    kind: "number",
    // fractions allowed (tests use a few seconds)
    check: (v: number) => (v >= 0 && v <= 10_080 ? v : fail("bad_request", "must be 0 (off) to 10080 minutes")),
  },
  hideInternalRefs: { kind: "boolean" },
  allowedOrigins: {
    kind: "list",
    check: (v: string[]) =>
      v.map((o) => (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(o.replace(/\/$/, "")) ? o.replace(/\/$/, "") : fail("bad_request", `bad origin ${o}`))),
  },
  "auth.enabled": { kind: "boolean" },
  "auth.rotateToken": { kind: "boolean" },
  "update.manifestUrl": {
    kind: "string",
    check: (v: string) => (v === "" || /^https?:\/\/\S+$/.test(v) ? v : fail("bad_request", "must be empty or an http(s) URL")),
  },
  "update.autoCheck": { kind: "boolean" },
};

function checkKind(kind: Kind, v: unknown): boolean {
  if (kind === "list") return Array.isArray(v) && v.every((x) => typeof x === "string");
  return typeof v === kind && (kind !== "number" || Number.isFinite(v));
}

/** Parse a CLI value (`gitnut config set key value`) into a one-key patch. */
export function patchFromCli(key: string, raw: string): SettingsPatch {
  const def = KEYS[key] ?? fail("bad_request", `unknown key ${key} (keys: ${Object.keys(KEYS).join(", ")})`);
  let v: unknown = raw;
  if (def.kind === "number") v = raw.trim() === "" ? Number.NaN : Number(raw);
  else if (def.kind === "boolean") {
    v = { true: true, on: true, yes: true, "1": true, false: false, off: false, no: false, "0": false }[raw.toLowerCase()];
    if (v === undefined) fail("bad_request", `${key} must be true or false`);
  } else if (def.kind === "list") {
    v = raw.trim().startsWith("[") ? JSON.parse(raw) : raw.split(",").map((x) => x.trim()).filter(Boolean);
  }
  const [a, b] = key.split(".");
  return (b ? { [a]: { [b]: v } } : { [a]: v }) as SettingsPatch;
}

export interface PatchResult {
  settings: Settings;
  restartRequired: boolean;
  /** New token when the patch rotated it. */
  token?: string;
}

/** Validate a patch and return the new settings. Shared by the CLI and `settings.update`. */
export function applyPatch(current: Settings, patch: SettingsPatch, force = false): PatchResult {
  if (!patch || typeof patch !== "object") fail("bad_request", "patch must be an object");
  const next = structuredClone(current);
  let token: string | undefined;
  for (const [k, v] of Object.entries(patch)) {
    const nested = k === "auth" || k === "update";
    const entries = nested ? Object.entries((v ?? {}) as object).map(([k2, v2]) => [`${k}.${k2}`, v2] as const) : [[k, v] as const];
    for (const [key, value] of entries) {
      const def = KEYS[key] ?? fail("bad_request", `unknown setting ${key}`);
      if (!checkKind(def.kind, value)) fail("bad_request", `${key} must be a ${def.kind}`);
      let val: unknown;
      try {
        val = def.check ? def.check(value) : value;
      } catch (e) {
        fail("bad_request", `${key}: ${(e as Error).message}`);
      }
      if (key === "auth.rotateToken") {
        if (val) next.auth.token = token = newToken();
      } else if (nested) {
        (next as any)[k][key.split(".")[1]] = val;
      } else {
        (next as any)[key] = val;
      }
    }
  }
  const touchesAuth = patch.bind !== undefined || patch.auth?.enabled !== undefined;
  if (touchesAuth && !next.auth.enabled && isPublicBind(next.bind) && !force) {
    fail("bad_request", `auth is off on the public bind "${next.bind}": anyone who can reach the port gets full access. Use force (--force) to allow it.`);
  }
  const restartRequired = RESTART_KEYS.some((k) => next[k] !== current[k]);
  return { settings: next, restartRequired, token };
}

/** Read a value by dot key from settings, never the token. */
export function getKey(s: Settings, key: string): unknown {
  if (key === "auth.token") fail("bad_request", "use `gitnut token` to print the token");
  const [a, b] = key.split(".");
  const v = b ? (s as any)[a]?.[b] : (s as any)[a];
  return v === undefined ? fail("bad_request", `unknown key ${key}`) : v;
}

/**
 * Patch for `repos add|remove`. Removing a repo that was found under a root (not listed
 * explicitly) excludes it instead; adding one removes it from `exclude` again.
 */
export function repoPatch(s: Settings, op: "add" | "remove", raw: unknown): SettingsPatch {
  if (typeof raw !== "string" || !raw) fail("bad_request", "path required");
  const path = expandHome(raw as string);
  if (op === "add") {
    const r = Bun.spawnSync(["git", "rev-parse", "--git-dir"], { cwd: existsSync(path) ? path : undefined, stdout: "ignore", stderr: "ignore" });
    if (!existsSync(path) || r.exitCode !== 0) fail("bad_request", `${path} is not a git repository`);
    return { repos: [...new Set([...s.repos, path])], exclude: s.exclude.filter((e) => e !== path) };
  }
  const underRoot = s.roots.some((r) => path === r || path.startsWith(r.endsWith(sep) ? r : r + sep));
  const patch: SettingsPatch = {};
  if (s.repos.includes(path)) patch.repos = s.repos.filter((r) => r !== path);
  // A repo found through a watched folder stays hidden via `exclude`.
  if (underRoot || !s.repos.includes(path)) patch.exclude = [...new Set([...s.exclude, path])];
  return patch;
}

/** Watch (add) or stop watching (remove) a folder. Adding also un-hides it. */
export function rootPatch(s: Settings, op: "add" | "remove", raw: unknown): SettingsPatch {
  if (typeof raw !== "string" || !raw) fail("bad_request", "path required");
  const dir = expandHome(raw as string);
  if (op === "add") {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail("bad_request", `${dir} is not a folder`);
    return { roots: [...new Set([...s.roots, dir])], exclude: s.exclude.filter((e) => e !== dir) };
  }
  return { roots: s.roots.filter((r) => r !== dir) };
}
