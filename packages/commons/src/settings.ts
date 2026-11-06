// Daemon settings. Stored as JSON in `<configDir>/config.json`
// (default `~/.gitnut`, override with GITNUT_HOME). Editable from the CLI and from clients.

/** `localhost` = 127.0.0.1, `tailscale` = the machine's Tailscale IPv4, `all` = 0.0.0.0, or an explicit IP. */
export type BindMode = "localhost" | "tailscale" | "all" | (string & {});

export interface Settings {
  /** Display name shown in clients. Empty = hostname. */
  name: string;
  port: number;
  bind: BindMode;
  auth: {
    /** When false, anyone who can reach the port has full access. */
    enabled: boolean;
    /** Access token, [A-Za-z0-9_-], 32+ chars. Never sent to clients. */
    token: string;
  };
  /** Serve the bundled web client at `/`. */
  serveWeb: boolean;
  /** Folders scanned for git repositories. */
  roots: string[];
  /** Explicit repository paths. */
  repos: string[];
  /** Paths (or path prefixes) never shown. */
  exclude: string[];
  /** How deep `roots` are scanned for `.git`. */
  scanDepth: number;
  /** How often subscribed worktrees and refs are checked for changes. */
  pollIntervalMs: number;
  /** Fetch all repositories every N minutes. 0 = off. */
  autoFetchMinutes: number;
  /**
   * Leave refs outside refs/heads, refs/remotes and refs/tags out of the graph: agent tools keep
   * checkpoint commits there (Jean `refs/jean/checkpoints/*`, T3 Code `refs/t3/*`).
   */
  hideInternalRefs: boolean;
  /** Extra browser origins allowed to use cookie / no-auth access (for embedding). */
  allowedOrigins: string[];
  update: {
    /** URL of the update manifest (`UpdateManifest`). Empty = updates off. */
    manifestUrl: string;
    autoCheck: boolean;
  };
}

export type PublicSettings = Omit<Settings, "auth"> & { auth: { enabled: boolean } };

export type SettingsPatch = Partial<Omit<Settings, "auth" | "update">> & {
  auth?: { enabled?: boolean; rotateToken?: boolean };
  update?: Partial<Settings["update"]>;
};

export const DEFAULT_SETTINGS: Omit<Settings, "auth"> & { auth: { enabled: boolean } } = {
  name: "",
  port: 7420,
  bind: "localhost",
  // Off by default for convenience: the default bind is 127.0.0.1 and browsers are held back by the Origin check.
  auth: { enabled: false },
  serveWeb: true,
  roots: [],
  repos: [],
  exclude: ["node_modules"],
  scanDepth: 3,
  pollIntervalMs: 2000,
  autoFetchMinutes: 0,
  hideInternalRefs: true,
  allowedOrigins: [],
  update: { manifestUrl: "", autoCheck: true },
};

/** Settings that need the HTTP listener to restart when they change. */
export const RESTART_KEYS = ["port", "bind", "serveWeb"] as const;

export function toPublicSettings(s: Settings): PublicSettings {
  return { ...s, auth: { enabled: s.auth.enabled } };
}

/** True when a bind mode exposes the daemon beyond this machine and the tailnet. */
export function isPublicBind(bind: BindMode): boolean {
  return bind !== "localhost" && bind !== "tailscale" && !bind.startsWith("127.") && bind !== "::1";
}
