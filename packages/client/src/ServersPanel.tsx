import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { dropConnection, fetchHealth, parseServerAddress, type ServerConfig } from "./connection";
import { confirmAction } from "./overlays";
import { useConnectionState, useServers, type ServerEntry } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { AddServerDialog } from "./AddServerDialog";
import { Button, IconButton } from "./ui";
import { Section } from "./form";

/** Props of {@link ServersPanel}. */
export interface ServersPanelProps extends StyleProps {}

/** The client's list of daemons: rename, change address or token, remove, add. Stored in this browser. */
export function ServersPanel(props: ServersPanelProps) {
  const { servers } = useServers();
  const [adding, setAdding] = useState(false);
  return (
    <GitnutRoot component="servers" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      <div className="gitnut-form">
        <Section title="Servers">
          <div className="gitnut-server-list" role="list" aria-label="Servers">
            {servers.map((s) => (
              <ServerRow key={s.conn.url} entry={s} />
            ))}
            {!servers.length && <div className="gitnut-muted">No servers yet.</div>}
          </div>
          <div>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
              Add server
            </Button>
          </div>
        </Section>
      </div>
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </GitnutRoot>
  );
}

/**
 * True when a daemon is reachable but refuses this page without a token (auth off there, so only its
 * own page may connect token-free): the row then says what to do instead of showing a grey dot.
 */
function useNeedsToken(entry: ServerEntry, state: string): boolean {
  const [needs, setNeeds] = useState(false);
  useEffect(() => {
    if (state === "open" || entry.sameOrigin || entry.conn.token) return setNeeds(false);
    let live = true;
    void fetchHealth(entry.conn.url).then((h) => live && setNeeds(!!h && (!h.originAllowed || h.authRequired)));
    return () => {
      live = false;
    };
  }, [entry, state]);
  return needs;
}

function ServerRow({ entry }: { entry: ServerEntry }) {
  const cx = useCx();
  const { addServer, removeServer } = useServers();
  const { state, info } = useConnectionState(entry.conn);
  const [edit, setEdit] = useState<ServerConfig | null>(null);
  const needsToken = useNeedsToken(entry, state);
  const remove = async () => {
    const ok = await confirmAction({ title: `Remove ${entry.conn.name}?`, message: `${entry.conn.url} is removed from this client. The daemon keeps running.`, confirmLabel: "Remove", danger: true });
    if (!ok) return;
    removeServer(entry.conn.url);
    dropConnection(entry.conn.url);
  };
  const save = () => {
    if (!edit) return;
    let url: string;
    try {
      url = parseServerAddress(edit.url);
    } catch {
      return;
    }
    const next = { url, name: edit.name?.trim() || undefined, token: edit.token?.trim() || undefined };
    if (url !== entry.conn.url) {
      removeServer(entry.conn.url);
      dropConnection(entry.conn.url);
    }
    addServer(next);
    if (url === entry.conn.url && next.token && next.token !== entry.conn.token) void entry.conn.login(next.token).catch(() => {});
    setEdit(null);
  };

  if (edit) {
    return (
      <form
        className="gitnut-server-row gitnut-server-edit"
        role="listitem"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input className={cx("input", "gitnut-input")} aria-label="Name" placeholder={info?.name ?? "Name"} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        <input className={cx("input", "gitnut-input", "gitnut-mono")} aria-label="Address" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
        <input className={cx("input", "gitnut-input")} aria-label="Access token" type="password" placeholder="Access token (gitnut token)" value={edit.token ?? ""} onChange={(e) => setEdit({ ...edit, token: e.target.value })} />
        <IconButton title="Save" type="submit" icon={<Check size={14} />} disabled={!edit.url.trim()} />
        <IconButton title="Cancel" icon={<X size={14} />} onClick={() => setEdit(null)} />
      </form>
    );
  }
  return (
    <div className="gitnut-server-row" role="listitem" data-server-row={entry.conn.url}>
      <span className={`gitnut-status-dot gitnut-state-${state}`} title={state} />
      <span className="gitnut-server-name">{entry.conn.name}</span>
      <span className="gitnut-mono gitnut-muted gitnut-server-url">{entry.conn.url}</span>
      {needsToken && (
        <span className="gitnut-error-text gitnut-server-hint" title="Run `gitnut token` on that machine, then Edit and paste it">
          needs its access token
        </span>
      )}
      <span className="gitnut-toolbar-spacer" />
      {entry.sameOrigin ? (
        <span className="gitnut-tree-hint">serves this page</span>
      ) : (
        <>
          <IconButton title={`Edit ${entry.conn.name}`} icon={<Pencil size={13} />} onClick={() => setEdit({ url: entry.conn.url, name: entry.config.name, token: entry.conn.token })} />
          <IconButton title={`Remove ${entry.conn.name}`} icon={<Trash2 size={13} />} onClick={() => void remove()} />
        </>
      )}
    </div>
  );
}
