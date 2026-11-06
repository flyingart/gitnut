// Standalone components on one page: each block uses only `server={{ url }}` (no provider), like a host app would.
import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CommitGraph, LocalChanges, LoginForm, useConnectionState, useRepos, type GitnutThemeInput, type ServerConfig } from "@gitnut/client";
import "@gitnut/client/styles.css";
import "./global.css";
import "./examples.css";

const q = new URLSearchParams(location.search);
const server: ServerConfig = { url: q.get("server") ?? location.origin, token: new URLSearchParams(location.hash.slice(1)).get("token") ?? undefined };

const customTheme: GitnutThemeInput = {
  base: "light",
  colors: { primary: "#0f766e", background: "#fbfaf7", surface: "#f4f2ec", raised: "#ffffff" },
  radius: { sm: "6px", md: "10px", lg: "16px" },
  controlHeight: { sm: "26px", md: "30px", lg: "38px" },
  fontSize: { xs: "12px", sm: "13px", md: "14px", lg: "17px" },
  density: "comfortable",
};

function Example({ id, title, code, children, height = 420 }: { id: string; title: string; code: string; children: ReactNode; height?: number }) {
  return (
    <section className="ex" id={id} data-example={id}>
      <h2>{title}</h2>
      <pre className="ex-code">{code}</pre>
      <div className="ex-frame" style={{ height }}>
        {children}
      </div>
    </section>
  );
}

function IframeExample({ worktree }: { worktree: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => e.source === ref.current?.contentWindow && e.data?.type === "gitnut:ready" && setReady(true);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const toggle = () => {
    setLight(!light);
    ref.current?.contentWindow?.postMessage({ type: "gitnut:setTheme", theme: light ? "dark" : "light" }, location.origin);
  };
  const src = `/?embed=1&view=changes&worktree=${encodeURIComponent(worktree)}`;
  return (
    <Example
      id="iframe"
      title="iframe embed with the postMessage theme API"
      code={`<iframe src="${src}" />\niframe.contentWindow.postMessage({ type: "gitnut:setTheme", theme: "light" }, origin)`}
    >
      <div className="ex-iframe-bar">
        <button type="button" onClick={toggle} disabled={!ready}>
          Switch to {light ? "dark" : "light"}
        </button>
        <span>{ready ? "gitnut:ready received" : "waiting for gitnut:ready…"}</span>
      </div>
      <iframe ref={ref} title="gitnut embed" src={src} />
    </Example>
  );
}

function Examples() {
  const { repos, conn } = useRepos(server);
  const { state } = useConnectionState(conn);
  const worktree = useMemo(() => {
    const want = q.get("worktree");
    const all = repos.flatMap((r) => r.worktrees);
    return want ?? (all.find((w) => w.counts.unstaged + w.counts.untracked + w.counts.staged > 0) ?? all[0])?.path;
  }, [repos]);
  const repo = repos.find((r) => r.name === q.get("repo") || r.id === q.get("repo")) ?? [...repos].sort((a, b) => b.worktrees.length - a.worktrees.length)[0];

  if (state === "unauthorized") return <LoginForm server={server} />;
  return (
    <main className="ex-page">
      <header>
        <h1>gitnut components</h1>
        <p>Each block below is one component from <code>@gitnut/client</code>, given only a daemon URL. No provider, no shared state.</p>
      </header>
      {!worktree || !repo ? (
        <p className="ex-wait">Waiting for the daemon's repositories…</p>
      ) : (
        <>
          <Example id="local-changes" title="Live local changes of one worktree" code={`<LocalChanges server={{ url, token }} worktreePath="${worktree}" />`}>
            <LocalChanges server={server} worktreePath={worktree} />
          </Example>
          <Example id="commit-graph" title="Commit graph only" code={`<CommitGraph server={{ url, token }} repoId="${repo.id}" />`} height={340}>
            <CommitGraph server={server} repoId={repo.id} />
          </Example>
          <Example
            id="custom-theme"
            title="Custom theme: light base, teal primary, larger radius and controls, comfortable density"
            code={`<LocalChanges server={{ url }} worktreePath="…"\n  theme={{ base: "light", colors: { primary: "#0f766e", … }, radius: { md: "10px", … }, density: "comfortable" }} />`}
            height={440}
          >
            <LocalChanges server={server} worktreePath={worktree} theme={customTheme} />
          </Example>
          <IframeExample worktree={worktree} />
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Examples />
  </StrictMode>,
);
