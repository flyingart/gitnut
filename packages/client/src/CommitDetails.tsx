import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Copy, GitCommitHorizontal } from "lucide-react";
import type { CommitFull, RefInfo } from "@gitnut/commons";
import { useGraphSnapshot } from "./hooks";
import { useConnection, type ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { RefPills } from "./graph/refs";
import { Button, copyText, Empty, formatFullDate, IconButton, Loading, shortHash } from "./ui";

/** Props of {@link CommitDetails}. */
export interface CommitDetailsProps extends StyleProps {
  server?: ServerProp;
  repoId: string;
  /** Selected commits; several show a summary. */
  hashes: string[];
  /** Click on a parent hash. */
  onNavigate?: (hash: string) => void;
}

const MAX = 50;

/** Message, author, committer, dates, hash, parents and refs of a commit; a summary for several. */
export function CommitDetails(props: CommitDetailsProps) {
  const cx = useCx();
  const conn = useConnection(props.server);
  const { snapshot } = useGraphSnapshot(props.repoId, props.server);
  const [commits, setCommits] = useState<CommitFull[] | null>(null);
  const key = props.hashes.slice(0, MAX).join(",");
  useEffect(() => {
    if (!conn || !key) return setCommits([]);
    let alive = true;
    setCommits(null);
    Promise.all(key.split(",").map((hash) => conn.call("commit.full", { repoId: props.repoId, hash }))).then(
      (c) => alive && setCommits(c),
      (e) => {
        console.warn("gitnut: commit.full failed", e);
        if (alive) setCommits([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [conn, key, props.repoId]);
  const refsOf = useMemo(() => {
    const m = new Map<number, RefInfo[]>();
    for (const r of snapshot?.refs ?? []) m.set(r.commit, [...(m.get(r.commit) ?? []), r]);
    return (c: CommitFull) => (c.index >= 0 ? (m.get(c.index) ?? []) : []);
  }, [snapshot]);

  let body: ReactNode;
  if (!props.hashes.length) body = <Empty icon={<GitCommitHorizontal size={22} />} title="Select a commit" />;
  else if (!commits) body = <Loading />;
  else if (!commits.length) body = <Empty title="Couldn't load the commit" />;
  else if (commits.length === 1) {
    const c = commits[0];
    const sameCommitter = c.committerName === c.authorName && c.committerEmail === c.authorEmail;
    body = (
      <div className="gitnut-details">
        <div className="gitnut-details-subject">{c.subject}</div>
        {c.body && <div className="gitnut-details-body">{reflow(c.body)}</div>}
        <div className="gitnut-details-refs">
          <RefPills refs={refsOf(c)} max={20} />
        </div>
        <dl className="gitnut-details-meta">
          <dt>Hash</dt>
          <dd className="gitnut-mono">
            {c.hash.slice(0, 12)}
            <IconButton title="Copy hash" icon={<Copy size={12} />} onClick={() => void copyText(c.hash)} />
          </dd>
          <dt>Author</dt>
          <dd>
            {c.authorName} <span className="gitnut-muted">&lt;{c.authorEmail}&gt;</span>
            <div className="gitnut-muted">{formatFullDate(c.authorTime)}</div>
          </dd>
          {!sameCommitter || c.commitTime !== c.authorTime ? (
            <>
              <dt>Committer</dt>
              <dd>
                {c.committerName} <span className="gitnut-muted">&lt;{c.committerEmail}&gt;</span>
                <div className="gitnut-muted">{formatFullDate(c.commitTime)}</div>
              </dd>
            </>
          ) : null}
          <dt>{c.parents.length === 1 ? "Parent" : "Parents"}</dt>
          <dd className="gitnut-mono">
            {c.parents.length ? c.parents.map((p) => (
              <Button key={p} variant="link" onClick={() => props.onNavigate?.(p)}>
                {shortHash(p)}
              </Button>
            )) : <span className="gitnut-muted">none (root commit)</span>}
          </dd>
        </dl>
      </div>
    );
  } else {
    const times = commits.map((c) => c.authorTime);
    const authors = [...new Set(commits.map((c) => c.authorName))];
    body = (
      <div className="gitnut-details">
        <div className="gitnut-details-subject">{props.hashes.length} commits selected</div>
        <div className="gitnut-muted gitnut-details-summary">
          {authors.length === 1 ? authors[0] : `${authors.length} authors`} · {formatFullDate(Math.min(...times))} – {formatFullDate(Math.max(...times))}
        </div>
        <ul className="gitnut-details-list">
          {commits.map((c) => (
            <li key={c.hash}>
              <span className="gitnut-mono gitnut-muted">{shortHash(c.hash)}</span>
              <span className="gitnut-details-list-subject">{c.subject}</span>
              <span className="gitnut-muted">{c.authorName}</span>
            </li>
          ))}
          {props.hashes.length > MAX && <li className="gitnut-muted">and {props.hashes.length - MAX} more</li>}
        </ul>
      </div>
    );
  }
  return (
    <GitnutRoot component="commit-details" theme={props.theme} className={cx("panel", props.className)} classNames={props.classNames} style={props.style}>
      <div className="gitnut-scroll gitnut-fill">{body}</div>
    </GitnutRoot>
  );
}

/** Join hard-wrapped lines of plain paragraphs (lists, indented blocks and trailers keep their lines). */
function reflow(body: string) {
  return body.split(/\n{2,}/).map((para, i) => {
    const lines = para.split("\n");
    const keep = lines.some((l) => /^(\s|[-*•>]|\d+[.)]\s|[\w-]+: )/.test(l));
    return (
      <p key={i} className={keep ? "gitnut-pre" : undefined}>
        {keep ? para : lines.join(" ")}
      </p>
    );
  });
}
