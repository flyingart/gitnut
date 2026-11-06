import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Box, Eye, Folder, House } from "lucide-react";
import type { BrowseResult, DiscoverResult } from "@gitnut/commons";
import { GitnutRpcError } from "./connection";
import { useConnection, type ServerProp } from "./provider";
import { useCx } from "./root";
import { Button, Dialog, IconButton, Spinner } from "./ui";
import { Checkbox } from "./form";

/** Props of {@link AddProjectsDialog}. */
export interface AddProjectsDialogProps {
  /** Daemon whose folders are browsed. Default: the provider's first server. */
  server?: ServerProp;
  onClose: () => void;
  /** Folder to open first. Default: the daemon user's home folder. */
  initialPath?: string;
}

/** Path of a repo relative to the browsed folder (`.` for the folder itself). */
const rel = (base: string, path: string) => path.slice(base.length + 1) || ".";
const msg = (e: unknown) => (e instanceof GitnutRpcError || e instanceof Error ? e.message : String(e));

/**
 * Pick projects on a daemon's machine: browse its folders, then add single repositories
 * (checkboxes) or watch the whole folder so every repo in it, also future ones, shows up.
 */
export function AddProjectsDialog({ server, onClose, initialPath }: AddProjectsDialogProps) {
  const cx = useCx();
  const conn = useConnection(server);
  const [input, setInput] = useState(initialPath ?? "");
  const [dir, setDir] = useState<BrowseResult | null>(null);
  const [found, setFound] = useState<DiscoverResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<"add" | "watch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<string | undefined>(undefined);

  const discover = useCallback(
    async (path: string) => {
      if (!conn) return;
      const d = await conn.call("repos.discover", { path });
      if (latest.current === path) setFound(d);
    },
    [conn],
  );

  const open = useCallback(
    async (path?: string) => {
      if (!conn) return;
      setError(null);
      try {
        const b = await conn.call("fs.browse", { path });
        latest.current = b.path;
        setDir(b);
        setInput(b.path);
        setPicked(new Set());
        setFound(null);
        await discover(b.path);
      } catch (e) {
        setError(msg(e));
      }
    },
    [conn, discover],
  );

  useEffect(() => {
    void open(initialPath);
  }, [open, initialPath]);

  const toggle = (p: string) => setPicked((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set([...s, p])));

  const run = async (kind: "add" | "watch", fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      setPicked(new Set());
      if (dir) await discover(dir.path);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };
  const addPicked = () => run("add", async () => {
    for (const path of picked) await conn!.call("repos.add", { path });
  });
  const isRoot = !!found && found.watchedBy === found.path;
  const toggleWatch = () => run("watch", () => conn!.call(isRoot ? "roots.remove" : "roots.add", { path: found!.path }));

  const addable = found?.repos.filter((r) => !r.added) ?? [];
  const allPicked = addable.length > 0 && addable.every((r) => picked.has(r.path));

  return (
    <Dialog title={`Add projects${conn ? ` on ${conn.name}` : ""}`} onClose={onClose} wide>
      <div className="gitnut-addproj">
        <form
          className="gitnut-addproj-path"
          onSubmit={(e) => {
            e.preventDefault();
            void open(input.trim() || undefined);
          }}
        >
          <IconButton title="Parent folder" icon={<ArrowUp size={14} />} disabled={!dir?.parent} onClick={() => dir?.parent && open(dir.parent)} />
          <IconButton title="Home folder" icon={<House size={14} />} disabled={!dir} onClick={() => dir && open(dir.home)} />
          <input className={cx("input", "gitnut-input", "gitnut-mono")} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Folder path" placeholder="/path/on/the/server" />
          <Button type="submit">Open</Button>
        </form>

        <div className="gitnut-addproj-panes">
          <div className="gitnut-addproj-pane">
            <div className="gitnut-addproj-head">Folders</div>
            <div className="gitnut-addproj-list gitnut-scroll" role="listbox" aria-label="Folders">
              {!dir ? (
                <div className="gitnut-proj-loading">{error ? null : <Spinner />}</div>
              ) : !dir.dirs.length ? (
                <div className="gitnut-proj-empty">No sub-folders</div>
              ) : (
                dir.dirs.map((d) => (
                  <button key={d.path} type="button" className={cx("row", "gitnut-addproj-row")} onClick={() => open(d.path)} title={d.path}>
                    {d.repo ? <Box size={13} className="gitnut-proj-icon" /> : <Folder size={13} className="gitnut-muted" />}
                    <span className="gitnut-proj-name">{d.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="gitnut-addproj-pane">
            <div className="gitnut-addproj-head">
              <span>Repositories here</span>
              <span className="gitnut-toolbar-spacer" />
              {addable.length > 1 && (
                <Checkbox checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(addable.map((r) => r.path)))}>
                  All
                </Checkbox>
              )}
            </div>
            <div className="gitnut-addproj-list gitnut-scroll" role="list" aria-label="Repositories">
              {!found ? (
                <div className="gitnut-proj-loading">{dir && !error ? <Spinner /> : null}</div>
              ) : !found.repos.length ? (
                <div className="gitnut-proj-empty">No git repositories in this folder.</div>
              ) : (
                found.repos.map((r) => (
                  <label key={r.path} className={cx("row", "gitnut-addproj-row", r.added && "gitnut-muted")} title={r.path} role="listitem">
                    <input type="checkbox" checked={r.added || picked.has(r.path)} disabled={r.added} onChange={() => toggle(r.path)} aria-label={r.name} />
                    <Box size={13} className="gitnut-proj-icon" />
                    <span className="gitnut-proj-name">{r.name}</span>
                    {rel(found.path, r.path) !== r.name && <span className="gitnut-tree-hint">{rel(found.path, r.path)}</span>}
                    <span className="gitnut-toolbar-spacer" />
                    {r.added && <span className="gitnut-tree-hint">added</span>}
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        {found?.watchedBy && !isRoot && (
          <div className="gitnut-muted gitnut-addproj-note">
            <Eye size={12} /> Inside the watched folder <code>{found.watchedBy}</code>: its repositories are listed automatically.
          </div>
        )}
        {error && <div className="gitnut-error-text">{error}</div>}

        <div className="gitnut-form-actions">
          <Button
            icon={<Eye size={14} />}
            busy={busy === "watch"}
            disabled={!found || (!!found.watchedBy && !isRoot)}
            onClick={toggleWatch}
            title="Every repository in this folder shows up, also ones created later"
          >
            {isRoot ? "Stop watching this folder" : "Watch whole folder"}
          </Button>
          <span className="gitnut-toolbar-spacer" />
          <Button onClick={onClose}>Done</Button>
          <Button variant="primary" busy={busy === "add"} disabled={!picked.size} onClick={addPicked}>
            {picked.size > 1 ? `Add ${picked.size} projects` : "Add project"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
