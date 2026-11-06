import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getConnection, normalizeUrl, type GitnutConnection, type ServerConfig } from "./connection";
import { ProviderThemeContext, type GitnutClassNames, type StyleProps } from "./root";
import { readStored } from "./storage";

export interface ServerEntry {
  config: ServerConfig;
  conn: GitnutConnection;
  /** The daemon that serves this page (cookie login, not persisted). */
  sameOrigin: boolean;
}

export interface GitnutContextValue {
  servers: ServerEntry[];
  addServer(config: ServerConfig): void;
  removeServer(url: string): void;
  updateServer(url: string, patch: Partial<ServerConfig>): void;
}

const GitnutContext = createContext<GitnutContextValue | null>(null);

/** Props of {@link GitnutProvider}. */
export interface GitnutProviderProps {
  /** Servers to show. Added to the persisted list (persisted ones keep their place). */
  servers?: ServerConfig[];
  /** Add the daemon that serves this page (`location.origin`, cookie auth). Default false. */
  sameOrigin?: boolean;
  /** localStorage key of the server list. Default `gitnut.servers`. */
  storageKey?: string;
  /** Persist servers added by the user. Default true. */
  persist?: boolean;
  /** Default theme of all gitnut components inside. */
  theme?: StyleProps["theme"];
  /** Default `classNames` of all gitnut components inside. */
  classNames?: GitnutClassNames;
  children?: ReactNode;
}

function load(key: string): ServerConfig[] {
  try {
    const v = JSON.parse(readStored(key) ?? "[]");
    return Array.isArray(v) ? v.filter((s) => s && typeof s.url === "string") : [];
  } catch {
    return [];
  }
}

/** Holds connections to many daemons. Components inside use them through hooks or a `server` URL prop. */
export function GitnutProvider({
  servers: given,
  sameOrigin = false,
  storageKey = "gitnut.servers",
  persist = true,
  theme,
  classNames,
  children,
}: GitnutProviderProps) {
  const [stored, setStored] = useState<ServerConfig[]>(() => (persist ? load(storageKey) : []));
  useEffect(() => {
    if (persist) localStorage.setItem(storageKey, JSON.stringify(stored));
  }, [stored, persist, storageKey]);

  const origin = typeof location !== "undefined" ? normalizeUrl(location.origin) : "";
  const configs = useMemo(() => {
    const out: { config: ServerConfig; sameOrigin: boolean }[] = [];
    const seen = new Set<string>();
    const add = (c: ServerConfig, same: boolean) => {
      const url = normalizeUrl(c.url);
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ config: { ...c, url }, sameOrigin: same });
    };
    if (sameOrigin && origin) add({ url: origin }, true);
    for (const s of stored) add(s, false);
    for (const s of given ?? []) add(s, false);
    return out;
  }, [stored, given, sameOrigin, origin]);

  const servers = useMemo(() => configs.map((c) => ({ ...c, conn: getConnection(c.config) })), [configs]);

  // Keep tokens from LoginForm (conn.login) in the stored list.
  useEffect(() => {
    const offs = servers
      .filter((s) => !s.sameOrigin)
      .map((s) =>
        s.conn.subscribe(() => {
          if (s.conn.token && s.conn.token !== s.config.token) {
            setStored((list) => {
              const has = list.some((x) => normalizeUrl(x.url) === s.conn.url);
              return has
                ? list.map((x) => (normalizeUrl(x.url) === s.conn.url ? { ...x, token: s.conn.token } : x))
                : [...list, { ...s.config, token: s.conn.token }];
            });
          }
        }),
      );
    return () => offs.forEach((o) => o());
  }, [servers]);

  const addServer = useCallback((c: ServerConfig) => {
    const url = normalizeUrl(c.url);
    setStored((list) => [...list.filter((x) => normalizeUrl(x.url) !== url), { ...c, url }]);
  }, []);
  const removeServer = useCallback((url: string) => {
    const u = normalizeUrl(url);
    setStored((list) => list.filter((x) => normalizeUrl(x.url) !== u));
  }, []);
  const updateServer = useCallback((url: string, patch: Partial<ServerConfig>) => {
    const u = normalizeUrl(url);
    setStored((list) => list.map((x) => (normalizeUrl(x.url) === u ? { ...x, ...patch } : x)));
  }, []);

  const value = useMemo(() => ({ servers, addServer, removeServer, updateServer }), [servers, addServer, removeServer, updateServer]);
  const themeValue = useMemo(() => ({ theme, classNames }), [theme, classNames]);
  return (
    <GitnutContext.Provider value={value}>
      <ProviderThemeContext.Provider value={themeValue}>{children}</ProviderThemeContext.Provider>
    </GitnutContext.Provider>
  );
}

/** The provider's servers (empty without a provider). */
export function useServers(): GitnutContextValue {
  return useContext(GitnutContext) ?? { servers: [], addServer: noop, removeServer: noop, updateServer: noop };
}
const noop = () => {};

/** True inside a GitnutProvider. */
export const useInProvider = () => useContext(GitnutContext) !== null;

/** A server: a config object, a URL / daemon id of a provider server, or nothing (the provider's first server). */
export type ServerProp = ServerConfig | string;

/** Resolve a `server` value against provider servers (non-hook form of useConnection). */
export function resolveConnection(servers: ServerEntry[] | undefined, server?: ServerProp): GitnutConnection | null {
  if (typeof server === "object") return getConnection(server);
  if (typeof server === "string") {
    const u = normalizeUrl(server);
    const hit = servers?.find((s) => s.conn.url === u || s.conn.info?.id === server);
    return hit ? hit.conn : /^https?:\/\//.test(server) ? getConnection({ url: server }) : null;
  }
  return servers?.[0]?.conn ?? null;
}

/** Resolve a component's `server` prop to a connection (shared per URL). Null when there is none. */
export function useConnection(server?: ServerProp): GitnutConnection | null {
  const ctx = useContext(GitnutContext);
  const key = typeof server === "object" ? `${server.url}\0${server.token ?? ""}` : (server ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveConnection(ctx?.servers, server), [key, ctx?.servers]);
}

/** Live connection state (re-renders on state / info changes). */
export function useConnectionState(conn: GitnutConnection | null) {
  useSyncExternalStore(
    (fn) => conn?.subscribe(fn) ?? noop,
    () => conn?.version ?? 0,
  );
  return { state: conn?.state ?? "offline", info: conn?.info ?? null, error: conn?.error ?? null, name: conn?.name ?? "" };
}
