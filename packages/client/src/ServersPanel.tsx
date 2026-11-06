import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { dropConnection, normalizeUrl, type ServerConfig } from "./connection";
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

function ServerRow({ entry }: { entry: ServerEntry }) {
  const cx = useCx();
  const { addServer, removeServer } = useServers();
  const { state, info } = useConnectionState(entry.conn);
  const [edit, setEdit] = useState<ServerConfig | null>(null);
  const remove = () => {
    if (!confirm(`Remove ${entry.conn.name} (${entry.conn.url}) from this client? The daemon keeps running.`)) return;
    removeServer(entry.conn.url);
    dropConnection(entry.conn.url);
  };
  const save = () => {
    if (!edit) return;
    const url = normalizeUrl(/^https?:\/\//.test(edit.url.trim()) ? edit.url.trim() : `http://${edit.url.trim()}`);
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
      <span className="gitnut-toolbar-spacer" />
      {entry.sameOrigin ? (
        <span className="gitnut-tree-hint">serves this page</span>
      ) : (
        <>
          <IconButton title={`Edit ${entry.conn.name}`} icon={<Pencil size={13} />} onClick={() => setEdit({ url: entry.conn.url, name: entry.config.name, token: entry.conn.token })} />
          <IconButton title={`Remove ${entry.conn.name}`} icon={<Trash2 size={13} />} onClick={remove} />
        </>
      )}
    </div>
  );
}
