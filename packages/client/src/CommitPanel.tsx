import { useEffect, useState } from "react";
import { useWorktree } from "./hooks";
import type { ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { Button, shortHash } from "./ui";
import { Checkbox } from "./form";

/** Props of {@link CommitPanel}. */
export interface CommitPanelProps extends StyleProps {
  server?: ServerProp;
  /** Worktree id or absolute path. */
  worktree: string;
  /** Files to commit (paths; renames need both paths). Undefined = all changes. */
  paths?: string[];
  /** Number of files that will be committed, for the button label. */
  fileCount?: number;
  onCommitted?: (hash: string) => void;
}

/** Commit message box with Amend and a Commit button (Ctrl/Cmd+Enter). */
export function CommitPanel(props: CommitPanelProps) {
  const cx = useCx();
  const { worktree: wt, repo, conn } = useWorktree(props.worktree, props.server);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // IntelliJ: ticking Amend fills in the last commit's message
  useEffect(() => {
    if (!amend || message || !conn || !repo || !wt?.head) return;
    conn.call("commit.full", { repoId: repo.id, hash: wt.head }).then((c) => setMessage([c.subject, c.body].filter(Boolean).join("\n\n")), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend]);

  const count = props.fileCount ?? props.paths?.length;
  const canCommit = !!wt && !!message.trim() && !busy && (count === undefined || count > 0 || amend);
  const commit = async () => {
    if (!canCommit || !conn || !wt) return;
    setBusy(true);
    setError(null);
    try {
      const r = await conn.call("worktree.commit", { worktreeId: wt.id, message: message.trim(), paths: props.paths ?? [], amend });
      setMessage("");
      setAmend(false);
      setDone(shortHash(r.hash));
      setTimeout(() => setDone(null), 4000);
      props.onCommitted?.(r.hash);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GitnutRoot component="commit-panel" theme={props.theme} className={cx("panel", props.className)} classNames={props.classNames} style={props.style}>
      <textarea
        className={cx("input", "gitnut-input", "gitnut-commit-message")}
        placeholder={wt?.branch ? `Commit message (to ${wt.branch})` : "Commit message"}
        aria-label="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void commit();
          }
        }}
      />
      {error && <div className="gitnut-error-text">{error}</div>}
      <div className="gitnut-commit-actions">
        <Checkbox checked={amend} onChange={setAmend}>
          Amend
        </Checkbox>
        <span className="gitnut-toolbar-spacer" />
        {done && <span className="gitnut-muted gitnut-count">Committed {done}</span>}
        <Button variant="primary" size="md" busy={busy} disabled={!canCommit} onClick={() => void commit()} title="Commit (Ctrl+Enter)">
          {amend ? "Amend commit" : count !== undefined ? `Commit ${count} ${count === 1 ? "file" : "files"}` : "Commit"}
        </Button>
      </div>
    </GitnutRoot>
  );
}
