import { useEffect, useState, type ReactNode } from "react";
import { Copy, RotateCw, TriangleAlert } from "lucide-react";
import { isPublicBind, type PublicSettings, type SettingsPatch } from "@gitnut/commons";
import { useSettings } from "./hooks";
import { useConnectionState, type ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { UpdateButton } from "./UpdateButton";
import { Button, copyText, Empty, Spinner } from "./ui";
import { Checkbox, Field, FieldRow, Section } from "./form";

/** Props of {@link SettingsPanel}. */
export interface SettingsPanelProps extends StyleProps {
  server?: ServerProp;
  /** Called after saving. */
  onSaved?: (settings: PublicSettings, restartRequired: boolean) => void;
}

type Draft = Omit<PublicSettings, "roots" | "repos" | "exclude" | "allowedOrigins"> & { roots: string; repos: string; exclude: string; allowedOrigins: string };
const BINDS = ["localhost", "tailscale", "all"];
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const toDraft = (s: PublicSettings): Draft => ({ ...s, roots: s.roots.join("\n"), repos: s.repos.join("\n"), exclude: s.exclude.join("\n"), allowedOrigins: s.allowedOrigins.join("\n") });

function diff(s: PublicSettings, d: Draft): SettingsPatch {
  const p: SettingsPatch = {};
  if (d.name !== s.name) p.name = d.name;
  if (Number(d.port) !== s.port) p.port = Number(d.port);
  if (d.bind !== s.bind) p.bind = d.bind;
  if (d.auth.enabled !== s.auth.enabled) p.auth = { enabled: d.auth.enabled };
  if (d.serveWeb !== s.serveWeb) p.serveWeb = d.serveWeb;
  if (s.hideInternalRefs !== undefined && d.hideInternalRefs !== s.hideInternalRefs) p.hideInternalRefs = d.hideInternalRefs;
  for (const k of ["roots", "repos", "exclude", "allowedOrigins"] as const) if (lines(d[k]).join("\n") !== s[k].join("\n")) p[k] = lines(d[k]);
  if (Number(d.scanDepth) !== s.scanDepth) p.scanDepth = Number(d.scanDepth);
  if (Number(d.pollIntervalMs) !== s.pollIntervalMs) p.pollIntervalMs = Number(d.pollIntervalMs);
  if (s.autoFetchMinutes !== undefined && Number(d.autoFetchMinutes) !== s.autoFetchMinutes) p.autoFetchMinutes = Number(d.autoFetchMinutes);
  if (d.update.manifestUrl !== s.update.manifestUrl || d.update.autoCheck !== s.update.autoCheck) p.update = { ...d.update };
  return p;
}

/** Edit a daemon's settings: name, network, auth and token, web, repositories, polling, embedding, updates. */
export function SettingsPanel(props: SettingsPanelProps) {
  const cx = useCx();
  const { settings, update, conn, error: loadError } = useSettings(props.server);
  const { info } = useConnectionState(conn);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: ReactNode } | null>(null);
  const [needForce, setNeedForce] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  useEffect(() => {
    if (settings && !draft) setDraft(toDraft(settings));
  }, [settings, draft]);

  if (!settings || !draft) {
    return (
      <GitnutRoot component="settings" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
        {loadError ? <Empty title="Couldn't load settings">{loadError.message}</Empty> : <div className="gitnut-center"><Spinner /></div>}
      </GitnutRoot>
    );
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const patch = diff(settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const customBind = !BINDS.includes(draft.bind);
  const publicNoAuth = !draft.auth.enabled && isPublicBind(draft.bind);

  const save = async (force = false) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await update(patch, force);
      setDraft(toDraft(r.settings));
      setNeedForce(false);
      const moved = patch.port !== undefined || patch.bind !== undefined;
      setMsg({ ok: true, text: r.restartRequired ? (moved ? `Saved. The daemon now listens on ${r.settings.bind}:${r.settings.port}; reconnect at the new address.` : "Saved. The daemon restarted its listener.") : "Saved." });
      props.onSaved?.(r.settings, r.restartRequired);
    } catch (e) {
      const text = (e as Error).message;
      if (/force/i.test(text)) setNeedForce(true);
      else setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!conn || !confirm("Rotate the access token? Every other client and browser has to log in again with the new token.")) return;
    setBusy(true);
    try {
      const r = await update({ auth: { rotateToken: true } });
      if (r.token) {
        setNewToken(r.token);
        await conn.login(r.token).catch(() => {});
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, input: ReactNode, hint?: ReactNode) => (
    <Field label={label} hint={hint}>
      {input}
    </Field>
  );
  const input = (k: "name" | "port" | "scanDepth" | "pollIntervalMs" | "autoFetchMinutes", type = "text", placeholder?: string) => (
    <input className={cx("input", "gitnut-input")} type={type} value={String(draft[k])} placeholder={placeholder} onChange={(e) => set(k, (type === "number" ? e.target.value : e.target.value) as never)} />
  );
  const list = (k: "roots" | "repos" | "exclude" | "allowedOrigins", placeholder: string) => (
    <textarea className={cx("input", "gitnut-input", "gitnut-list-input")} rows={Math.max(2, Math.min(6, draft[k].split("\n").length + 1))} value={draft[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} spellCheck={false} />
  );

  return (
    <GitnutRoot component="settings" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      <form
        className="gitnut-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Section title="Daemon">
          {field("Name", input("name", "text", info?.name ?? "hostname"), "Shown in clients. Empty = the host name.")}
          <FieldRow>
            {field("Port", input("port", "number"))}
            {field(
              "Listen on",
              <FieldRow>
                <select className={cx("input", "gitnut-input")} value={customBind ? "custom" : draft.bind} onChange={(e) => set("bind", e.target.value === "custom" ? "" : e.target.value)}>
                  <option value="localhost">This machine only (127.0.0.1)</option>
                  <option value="tailscale">Tailscale IP</option>
                  <option value="all">All interfaces (0.0.0.0)</option>
                  <option value="custom">Specific IP…</option>
                </select>
                {customBind && <input className={cx("input", "gitnut-input")} placeholder="192.168.1.20" value={draft.bind} onChange={(e) => set("bind", e.target.value)} />}
              </FieldRow>,
            )}
          </FieldRow>
          {info && <small className="gitnut-muted">Listening on {info.listen} · gitnut {info.version} · {info.platform}</small>}
        </Section>

        <Section title="Access">
          <Checkbox checked={draft.auth.enabled} onChange={(v) => set("auth", { enabled: v })}>
            Require the access token
          </Checkbox>
          {publicNoAuth && (
            <div className="gitnut-warning">
              <TriangleAlert size={14} /> Without a token anyone who can reach {draft.bind}:{draft.port} can read your repositories and commit, pull and push.
            </div>
          )}
          <FieldRow center>
            <Button icon={<RotateCw size={13} />} onClick={() => void rotate()} disabled={busy}>
              Rotate token
            </Button>
            <small className="gitnut-muted">Creates a new token and logs out every other client.</small>
          </FieldRow>
          {newToken && (
            <div className="gitnut-token-box" role="status">
              <div>New token, shown once. Use it to log in from other clients:</div>
              <code className="gitnut-mono" data-testid="new-token">{newToken}</code>
              <Button size="sm" icon={<Copy size={12} />} onClick={() => void copyText(newToken)}>
                Copy
              </Button>
            </div>
          )}
          {field("Allowed origins", list("allowedOrigins", "https://my-dashboard.example"), "Websites that may embed this daemon with cookie or no-auth access. One per line.")}
        </Section>

        <Section title="Repositories">
          {field("Root folders", list("roots", "/home/me/projects"), "Scanned for git repositories. One per line.")}
          {field("Repositories", list("repos", "/srv/repo.git"), "Extra repositories outside the roots.")}
          {field("Exclude", list("exclude", "node_modules"), "Paths or path prefixes never shown.")}
          <FieldRow>
            {field("Scan depth", input("scanDepth", "number"))}
            {field("Poll interval (ms)", input("pollIntervalMs", "number"), "How often watched worktrees are checked.")}
          </FieldRow>
          {field("Auto-fetch every (minutes)", input("autoFetchMinutes", "number", "0"), "Fetch all repositories on this interval. 0 = off.")}
          {draft.hideInternalRefs !== undefined && (
            <Checkbox checked={draft.hideInternalRefs} onChange={(v) => set("hideInternalRefs", v)} title="Refs outside refs/heads, refs/remotes and refs/tags, such as refs/jean/checkpoints/* and refs/t3/*">
              Hide agent checkpoint commits (Jean, T3 Code and other private refs)
            </Checkbox>
          )}
        </Section>

        <Section title="Web client and updates">
          <Checkbox checked={draft.serveWeb} onChange={(v) => set("serveWeb", v)}>
            Serve the web client at /
          </Checkbox>
          <Checkbox checked={draft.update.autoCheck} onChange={(v) => set("update", { ...draft.update, autoCheck: v })}>
            Check for updates automatically
          </Checkbox>
          <UpdateButton server={props.server} showWhenCurrent />
        </Section>

        {needForce && (
          <div className="gitnut-warning" role="alert">
            <TriangleAlert size={14} />
            <span>Turning the token off on a public address exposes this daemon to the network.</span>
            <Button variant="danger" size="sm" onClick={() => void save(true)} busy={busy}>
              Save anyway
            </Button>
          </div>
        )}
        {msg && <div className={msg.ok ? "gitnut-ok-text" : "gitnut-error-text"} role="status">{msg.text}</div>}
        <div className="gitnut-form-actions">
          <Button disabled={!dirty || busy} onClick={() => (setDraft(toDraft(settings)), setNeedForce(false))}>
            Reset
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </GitnutRoot>
  );
}
