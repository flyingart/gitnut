import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CombinedLocalChanges,
  GitnutApp,
  GitnutProvider,
  LocalChanges,
  LoginForm,
  LogView,
  useConnectionState,
  useRepos,
  type GitnutThemeInput,
  type ViewOptions,
} from "@gitnut/client";
import "@gitnut/client/styles.css";
import "./global.css";
import { readParams, type AppParams } from "./params";

const params = readParams();
if (params.embed) document.body.classList.add("gitnut-embed");
// keep the token out of the address bar and history
if (location.hash.includes("token=")) history.replaceState(null, "", location.pathname + location.search);

/** Embedded single view: only the requested component, transparent background. */
function EmbedView({ p, theme, options }: { p: AppParams; theme: GitnutThemeInput | "dark" | "light" | undefined; options: Partial<ViewOptions> }) {
  const server = p.server?.url;
  const { repos, conn } = useRepos(server);
  const { state } = useConnectionState(conn);
  if (state === "unauthorized") return <LoginForm server={server} theme={theme} />;
  if (p.view === "all-changes") return <CombinedLocalChanges theme={theme} mode={options.changesMode} />;
  if (p.view === "changes" && p.worktree) return <LocalChanges server={server} worktreePath={p.worktree} theme={theme} mode={options.changesMode} />;
  const repo = repos.find((r) => [r.id, r.path, r.name].includes(p.repo ?? "")) ?? repos.find((r) => r.worktrees.some((w) => w.path === p.worktree));
  if (repo) return <LogView server={server} repoId={repo.id} theme={theme} showRefs={options.showRefs} />;
  return null;
}

function Root() {
  const [theme, setTheme] = useState(() => withEmbedBackground(params.theme, params.embed));
  const [options, setOptions] = useState<Partial<ViewOptions>>(params.options ?? {});
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "gitnut:setTheme") setTheme(withEmbedBackground(d.theme, params.embed));
      if (d.type === "gitnut:setOptions" && d.options && typeof d.options === "object") setOptions((o) => ({ ...o, ...d.options }));
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: "gitnut:ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const servers = useMemo(() => (params.server ? [params.server] : undefined), []);
  const single = params.embed && (params.view === "all-changes" || params.worktree || params.repo);
  return (
    <GitnutProvider servers={servers} sameOrigin={!params.server} persist={!params.server && !params.embed} theme={theme}>
      {single ? (
        <EmbedView p={params} theme={theme} options={options} />
      ) : (
        <GitnutApp theme={theme} view={params.view} repo={params.repo} worktree={params.worktree} options={options} tabsKey={params.embed || params.server ? null : "gitnut.tabs"} />
      )}
    </GitnutProvider>
  );
}

function withEmbedBackground(theme: GitnutThemeInput | "dark" | "light" | undefined, embed: boolean): GitnutThemeInput | "dark" | "light" | undefined {
  if (!embed) return theme;
  const base = typeof theme === "string" ? { base: theme } : (theme ?? {});
  return { ...base, colors: { ...base.colors, background: "transparent" } };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
