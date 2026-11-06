import type { GitnutThemeInput, ServerConfig, ViewOptions } from "@gitnut/client";

export interface AppParams {
  embed: boolean;
  theme?: GitnutThemeInput | "dark" | "light";
  server?: ServerConfig;
  view?: "log" | "changes" | "all-changes";
  repo?: string;
  worktree?: string;
  options?: Partial<ViewOptions>;
}

/** URL params: embed=1, theme=<name|json>, server=<url> (+ #token=), view, repo, worktree, options=<json>. */
export function readParams(loc: Location = location): AppParams {
  const q = new URLSearchParams(loc.search);
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ""));
  const json = <T,>(v: string | null): T | undefined => {
    if (!v) return undefined;
    try {
      return JSON.parse(v) as T;
    } catch {
      return undefined;
    }
  };
  const t = q.get("theme");
  const view = q.get("view");
  const server = q.get("server");
  return {
    embed: q.get("embed") === "1" || q.get("embed") === "true",
    theme: t === "dark" || t === "light" ? t : json<GitnutThemeInput>(t),
    server: server ? { url: server, token: hash.get("token") ?? undefined } : undefined,
    view: view === "log" || view === "changes" || view === "all-changes" ? view : undefined,
    repo: q.get("repo") ?? undefined,
    worktree: q.get("worktree") ?? undefined,
    options: json<Partial<ViewOptions>>(q.get("options")),
  };
}
