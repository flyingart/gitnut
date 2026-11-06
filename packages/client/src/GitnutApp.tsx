import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Copy, Minus, Square, FolderPlus, GitBranch, Keyboard, Layers, List, ListTree, PanelLeft, Plus, Server, Settings, X } from "lucide-react";
import type { RepoSummary } from "@gitnut/commons";
import { AddProjectsDialog } from "./AddProjectsDialog";
import { AddServerDialog } from "./AddServerDialog";
import { AppearancePanel } from "./AppearancePanel";
import { CombinedLocalChanges } from "./CombinedLocalChanges";
import type { GitnutConnection } from "./connection";
import { useReposOf } from "./hooks";
import { LocalChanges } from "./LocalChanges";
import { LoginForm } from "./LoginForm";
import { LogView } from "./LogView";
import { Logo } from "./Logo";
import { ProjectsList } from "./ProjectsList";
import { GitnutProvider, useConnectionState, useInProvider, useServers, type GitnutProviderProps, type ServerEntry } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { ServersPanel } from "./ServersPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Shortcuts } from "./Shortcuts";
import { accentTheme } from "./theme";
import { desktopWindow, dragRegion, useDesktopVersion, useWindowMaximized } from "./desktop";
import { CLIENT_VERSION } from "./version";
import { UpdateButton } from "./UpdateButton";
import { Button, Dialog, Empty, IconButton, Menu, MenuButton, Popover, useContextMenu, worktreeLabel } from "./ui";
import { useViewOptions, type ViewOptions } from "./viewOptions";

export type AppView = "log" | "changes" | "all-changes";

/** Props of {@link GitnutApp}. Without a surrounding GitnutProvider the app creates one from the provider props. */
export interface GitnutAppProps extends StyleProps, Omit<GitnutProviderProps, "children" | "theme" | "classNames"> {
  /** Open this view first. */
  view?: AppView;
  /** Repository to open: id, path or name. */
  repo?: string;
  /** Worktree to open (absolute path or id), for the "changes" view. */
  worktree?: string;
  /** Fix view options (their toggles are hidden). */
  options?: Partial<ViewOptions>;
  /** Projects sidebar. Default true. */
  showSidebar?: boolean;
  /** Remember open tabs in localStorage under this key. Default `gitnut.tabs`; null = off. */
  tabsKey?: string | null;
}

interface Tab {
  id: string;
  kind: AppView;
  server: string;
  repoId?: string;
  worktreeId?: string;
  title: string;
}

/** The whole client: projects sidebar, tabs with the IntelliJ-style log and local changes, settings. */
export function GitnutApp(props: GitnutAppProps) {
  if (useInProvider()) return <AppInner {...props} />;
  return (
    <GitnutProvider servers={props.servers} sameOrigin={props.sameOrigin} storageKey={props.storageKey} persist={props.persist}>
      <AppInner {...props} />
    </GitnutProvider>
  );
}

function loadTabs(key: string | null): { tabs: Tab[]; active: string | null } {
  if (!key) return { tabs: [], active: null };
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    if (v && Array.isArray(v.tabs)) return v;
  } catch {}
  return { tabs: [], active: null };
}

function AppInner(props: GitnutAppProps) {
  const cx = useCx();
  const { servers } = useServers();
  const tabsKey = props.tabsKey === undefined ? "gitnut.tabs" : props.tabsKey;
  const [state, setState] = useState(() => loadTabs(tabsKey));
  const [dialog, setDialog] = useState<null | "add" | "settings" | "keys" | { login: GitnutConnection } | { addProjects: string }>(null);
  const [settingsServer, setSettingsServer] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const { options, set, locked } = useViewOptions(props.options);
  // A host theme wins; otherwise the user's appearance choice (settings dialog).
  const theme = useMemo(() => props.theme ?? accentTheme(options.accent, options.scheme), [props.theme, options.accent, options.scheme]);
  useEffect(() => {
    if (tabsKey) localStorage.setItem(tabsKey, JSON.stringify(state));
  }, [state, tabsKey]);

  const conns = useMemo(() => servers.map((s) => s.conn), [servers]);
  const repoStates = useReposOf(conns);
  const findRepo = (server: string, repoId?: string) => repoStates[conns.findIndex((c) => c.url === server)]?.data?.find((r) => r.id === repoId);

  const openTab = (t: Omit<Tab, "id">) => {
    const id = `${t.kind}|${t.server}|${t.repoId ?? ""}|${t.worktreeId ?? ""}`;
    // without tabs the sidebar switches the one open view
    if (!options.showTabs) return setState({ tabs: [{ ...t, id }], active: id });
    setState((s) => ({ tabs: s.tabs.some((x) => x.id === id) ? s.tabs : [...s.tabs, { ...t, id }], active: id }));
  };
  /** Keep only the tabs `keep` accepts (index, tab); the active one falls back to its left neighbour. */
  const keepTabs = (keep: (i: number, t: Tab) => boolean) =>
    setState((s) => {
      const tabs = s.tabs.filter((t, i) => keep(i, t));
      if (tabs.some((t) => t.id === s.active)) return { tabs, active: s.active };
      const i = s.tabs.findIndex((t) => t.id === s.active);
      const left = s.tabs.slice(0, i).reverse().find((t) => tabs.includes(t));
      return { tabs, active: (left ?? tabs[0])?.id ?? null };
    });
  const closeTab = (id: string) => keepTabs((_, t) => t.id !== id);
  const tabMenu = useContextMenu();
  const openTabMenu = (at: { clientX: number; clientY: number }, id: string) => {
    const i = state.tabs.findIndex((t) => t.id === id);
    const n = state.tabs.length;
    tabMenu.open(at, [
      { label: "Close", icon: <X size={13} />, onSelect: () => closeTab(id) },
      { label: "Close others", disabled: n < 2, onSelect: () => keepTabs((_, t) => t.id === id) },
      { label: "Close tabs to the left", disabled: i === 0, onSelect: () => keepTabs((j) => j >= i) },
      { label: "Close tabs to the right", disabled: i === n - 1, onSelect: () => keepTabs((j) => j <= i) },
      "separator",
      { label: "Close all", onSelect: () => keepTabs(() => false) },
    ]);
  };
  // views of a removed server close
  useEffect(() => {
    if (state.tabs.some((t) => t.kind !== "all-changes" && !conns.some((c) => c.url === t.server))) keepTabs((_, t) => t.kind === "all-changes" || conns.some((c) => c.url === t.server));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conns]);
  // turning tabs off keeps only the active view
  useEffect(() => {
    if (!options.showTabs && state.tabs.length > 1) keepTabs((_, t) => t.id === state.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.showTabs]);

  // initial view from props (URL params in the web app)
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (applied) return;
    if (props.view === "all-changes") {
      openTab({ kind: "all-changes", server: "", title: "All uncommitted changes" });
      return setApplied(true);
    }
    if (!props.repo && !props.worktree) return setApplied(true);
    for (let i = 0; i < conns.length; i++) {
      for (const repo of repoStates[i]?.data ?? []) {
        const wt = props.worktree ? repo.worktrees.find((w) => w.id === props.worktree || w.path === props.worktree?.replace(/\/+$/, "")) : undefined;
        if (props.worktree && wt) {
          openTab({ kind: props.view === "log" ? "log" : "changes", server: conns[i].url, repoId: repo.id, worktreeId: wt.id, title: props.view === "log" ? repo.name : `${repo.name}: ${worktreeLabel(wt)}` });
          return setApplied(true);
        }
        if (!props.worktree && props.repo && [repo.id, repo.path, repo.name].includes(props.repo)) {
          const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
          if (props.view === "changes" && main) openTab({ kind: "changes", server: conns[i].url, repoId: repo.id, worktreeId: main.id, title: `${repo.name}: ${worktreeLabel(main)}` });
          else openTab({ kind: "log", server: conns[i].url, repoId: repo.id, title: repo.name });
          return setApplied(true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoStates, applied]);

  const active = state.tabs.find((t) => t.id === state.active) ?? null;
  const activeConn = active ? conns.find((c) => c.url === active.server) : undefined;
  const selection = active?.repoId ? { server: active.server, repoId: active.repoId, worktreeId: active.kind === "changes" ? active.worktreeId : undefined } : null;

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "?" ) setDialog("keys");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onlyServer = servers.length === 1 ? servers[0] : null;
  const fullLogin = onlyServer && onlyServer.conn.state === "unauthorized";
  const settingsConn = conns.find((c) => c.url === settingsServer) ?? activeConn ?? conns[0];

  return (
    <GitnutRoot component="app" theme={theme} className={props.className} classNames={props.classNames} style={props.style}>
      <ConnWatcher conns={conns} />
      {fullLogin ? (
        <LoginForm server={onlyServer.conn.url} />
      ) : (
        <div className="gitnut-app-layout">
          {props.showSidebar !== false && sidebar && (
            <aside className={cx("sidebar", "gitnut-sidebar", "gitnut-glass")} aria-label="Projects">
              <div className="gitnut-sidebar-head" {...dragRegion}>
                <Logo size={22} />
                <span className="gitnut-wordmark">
                  git<span>nut</span>
                </span>
                {conns.map((c) => (
                  <UpdateButton key={c.url} server={c.url} compact label={conns.length > 1 ? c.name : undefined} />
                ))}
                <span className="gitnut-toolbar-spacer" />
                {!locked("projectsGrouping") && (
                  <IconButton
                    title={options.projectsGrouping === "server" ? "Show projects as one list" : "Group projects by server"}
                    icon={options.projectsGrouping === "server" ? <List size={14} /> : <ListTree size={14} />}
                    onClick={() => set("projectsGrouping", options.projectsGrouping === "server" ? "flat" : "server")}
                  />
                )}
                <Popover title="Add projects or a server" icon={<Plus size={14} />} align="right">
                  {(close) => (
                    <Menu>
                      {conns
                        .filter((c) => c.state === "open")
                        .map((c) => (
                          <MenuButton key={c.url} icon={<FolderPlus size={13} />} onClick={() => (close(), setDialog({ addProjects: c.url }))}>
                            Add projects{conns.length > 1 ? ` on ${c.name}` : ""}…
                          </MenuButton>
                        ))}
                      <MenuButton icon={<Server size={13} />} onClick={() => (close(), setDialog("add"))}>
                        Add server…
                      </MenuButton>
                    </Menu>
                  )}
                </Popover>
              </div>
              <button type="button" className={cx("row", "gitnut-sidebar-entry", active?.kind === "all-changes" && "gitnut-selected")} onClick={() => openTab({ kind: "all-changes", server: "", title: "All uncommitted changes" })}>
                <Layers size={14} /> All uncommitted changes
              </button>
              <ProjectsList
                className="gitnut-fill"
                selected={selection}
                onSelectRepo={(sel, repo) => openTab({ kind: "log", server: sel.server, repoId: repo.id, title: repo.name })}
                onSelectWorktree={(sel, wt, repo) => openTab({ kind: "changes", server: sel.server, repoId: repo.id, worktreeId: wt.id, title: `${repo.name}: ${worktreeLabel(wt)}` })}
                onLogin={(conn) => setDialog({ login: conn })}
                onAddProjects={(conn) => setDialog({ addProjects: conn.url })}
                onRemoveRepo
              />
              <div className="gitnut-sidebar-foot">
                <IconButton title="Settings" icon={<Settings size={14} />} onClick={() => setDialog("settings")} />
                <IconButton title="Keyboard shortcuts (?)" icon={<Keyboard size={14} />} onClick={() => setDialog("keys")} />
                <span className="gitnut-toolbar-spacer" />
                <ServerSummary servers={servers} />
              </div>
            </aside>
          )}
          <main className="gitnut-main">
            <div className={cx("tabs", "gitnut-tabs")} role="tablist" {...dragRegion}>
              {props.showSidebar !== false && (
                <IconButton title={sidebar ? "Hide projects" : "Show projects"} icon={<PanelLeft size={14} />} onClick={() => setSidebar(!sidebar)} />
              )}
              {!options.showTabs && active && (
                <div className="gitnut-view-title" title={active.title}>
                  {active.kind === "log" ? <Box size={12} /> : active.kind === "changes" ? <GitBranch size={12} /> : <Layers size={12} />}
                  <span>{active.title}</span>
                  {active.kind === "log" && <span className="gitnut-tab-kind">Log</span>}
                </div>
              )}
              {options.showTabs && state.tabs.map((t) => (
                <div
                  key={t.id}
                  role="tab"
                  aria-selected={t.id === state.active}
                  className={cx(null, "gitnut-tab", t.id === state.active && "gitnut-active")}
                  onClick={() => setState((s) => ({ ...s, active: t.id }))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openTabMenu(e, t.id);
                  }}
                  onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
                  title={t.title}
                >
                  {t.kind === "log" ? <Box size={12} /> : t.kind === "changes" ? <GitBranch size={12} /> : <Layers size={12} />}
                  <span>{t.title}</span>
                  {t.kind === "log" && <span className="gitnut-tab-kind">Log</span>}
                  <IconButton
                    size="xs"
                    className="gitnut-tab-close"
                    title={`Close ${t.title}`}
                    icon={<X size={11} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  />
                </div>
              ))}
              {desktopWindow && (
                <>
                  <span className="gitnut-toolbar-spacer" {...dragRegion} />
                  <WindowControls />
                </>
              )}
            </div>
            {tabMenu.menu}
            <div className="gitnut-main-body">
              {!active ? (
                <Welcome
                  repos={repoStates.flatMap((s) => s.data ?? [])}
                  hasServers={servers.length > 0}
                  onAdd={() => setDialog("add")}
                  onAddProjects={() => conns[0] && setDialog({ addProjects: conns[0].url })}
                />
              ) : activeConn?.state === "unauthorized" ? (
                <LoginForm server={activeConn.url} />
              ) : active.kind === "log" && active.repoId ? (
                <LogView key={active.id} server={active.server} repoId={active.repoId} showRefs={props.options?.showRefs} diffPreview={props.options?.diffPreview} />
              ) : active.kind === "changes" && active.worktreeId ? (
                <LocalChanges
                  key={active.id}
                  server={active.server}
                  worktreeId={active.worktreeId}
                  mode={props.options?.changesMode}
                  headerExtra={
                    <Button variant="link" onClick={() => active.repoId && openTab({ kind: "log", server: active.server, repoId: active.repoId, title: findRepo(active.server, active.repoId)?.name ?? "Log" })}>
                      Show log
                    </Button>
                  }
                />
              ) : (
                <CombinedLocalChanges key="all" mode={props.options?.changesMode} />
              )}
            </div>
          </main>
        </div>
      )}
      {dialog === "add" && <AddServerDialog onClose={() => setDialog(null)} />}
      {dialog === "keys" && (
        <Dialog title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <Shortcuts />
        </Dialog>
      )}
      {dialog === "settings" && settingsConn && (
        <Dialog title="Settings" onClose={() => setDialog(null)} wide>
          {props.theme === undefined && <AppearancePanel />}
          <ServersPanel />
          <div className="gitnut-settings-server-title">Server · {settingsConn.name}</div>
          {conns.length > 1 && (
            <select className="gitnut-input gitnut-settings-server" value={settingsConn.url} onChange={(e) => setSettingsServer(e.target.value)} aria-label="Server">
              {conns.map((c) => (
                <option key={c.url} value={c.url}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {settingsConn.state === "unauthorized" ? <LoginForm server={settingsConn.url} variant="inline" /> : <SettingsPanel key={settingsConn.url} server={settingsConn.url} />}
          <VersionFooter />
        </Dialog>
      )}
      {dialog && typeof dialog === "object" && "addProjects" in dialog && <AddProjectsDialog server={dialog.addProjects} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === "object" && "login" in dialog && (
        <Dialog title="Log in" onClose={() => setDialog(null)}>
          <LoginForm server={dialog.login.url} variant="inline" onSuccess={() => setDialog(null)} />
        </Dialog>
      )}
    </GitnutRoot>
  );
}

/** Minimize / maximize / close for the app's own title bar (Windows, see desktop.ts). */
function WindowControls() {
  const maximized = useWindowMaximized();
  if (!desktopWindow) return null;
  return (
    <div className="gitnut-window-controls">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void desktopWindow?.minimize()}>
        <Minus size={14} />
      </button>
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => void desktopWindow?.toggleMaximize()}>
        {maximized ? <Copy size={11} /> : <Square size={11} />}
      </button>
      <button type="button" className="gitnut-window-close" aria-label="Close" title="Close" onClick={() => void desktopWindow?.close()}>
        <X size={15} />
      </button>
    </div>
  );
}

/** Bottom line of the settings: client (web) version, desktop app version when inside it. */
function VersionFooter() {
  const app = useDesktopVersion();
  return (
    <div className="gitnut-version-footer gitnut-muted" data-testid="version-footer">
      GitNut {CLIENT_VERSION}
      {app && ` · desktop app ${app}`}
    </div>
  );
}

/** Re-render the app when any connection changes state. */
function ConnWatcher({ conns }: { conns: GitnutConnection[] }) {
  const [, force] = useState(0);
  useEffect(() => {
    const offs = conns.map((c) => c.subscribe(() => force((n) => n + 1)));
    return () => offs.forEach((o) => o());
  }, [conns]);
  return null;
}

function ServerSummary({ servers }: { servers: ServerEntry[] }) {
  const first = servers[0]?.conn ?? null;
  const { state } = useConnectionState(first);
  if (!servers.length) return null;
  const online = servers.filter((s) => s.conn.state === "open").length;
  return (
    <span className="gitnut-muted gitnut-count" title={servers.map((s) => `${s.conn.name}: ${s.conn.state}`).join("\n")} data-state={state}>
      <span className={`gitnut-status-dot gitnut-state-${online === servers.length ? "open" : online ? "connecting" : "offline"}`} /> {online}/{servers.length} online
    </span>
  );
}

function Welcome({ repos, hasServers, onAdd, onAddProjects }: { repos: RepoSummary[]; hasServers: boolean; onAdd: () => void; onAddProjects: () => void }): ReactNode {
  if (!hasServers)
    return (
      <Empty icon={<Logo size={40} />} title="Connect a daemon">
        Run <code>gitnut serve</code> on a machine, then{" "}
        <Button variant="link" onClick={onAdd}>
          add it as a server
        </Button>
        .
      </Empty>
    );
  return (
    <Empty icon={<Logo size={40} />} title="Pick a project">
      {repos.length ? (
        `${repos.length} repositories on your servers. Choose one on the left to see its history, or a worktree for its uncommitted changes.`
      ) : (
        <>
          No projects yet.{" "}
          <Button variant="link" onClick={onAddProjects}>
            Add projects
          </Button>{" "}
          one by one or watch a whole folder.
        </>
      )}
    </Empty>
  );
}
