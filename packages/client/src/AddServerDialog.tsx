import { useState } from "react";
import { normalizeUrl, type ServerConfig } from "./connection";
import { useServers } from "./provider";
import { Dialog, Button } from "./ui";
import { useCx } from "./root";
import { Field } from "./form";

/** Props of {@link AddServerDialog}. */
export interface AddServerDialogProps {
  onClose: () => void;
  /** Default: add to the provider's list. */
  onAdd?: (server: ServerConfig) => void;
}

/** Dialog to add a daemon by URL (+ token). Checks `/api/health` first. */
export function AddServerDialog({ onClose, onAdd }: AddServerDialogProps) {
  const cx = useCx();
  const { addServer } = useServers();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let u = url.trim();
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    if (!/:\d+$/.test(new URL(u).host) && !u.startsWith("https")) u = `${normalizeUrl(u)}:7420`;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(normalizeUrl(u) + "/api/health");
      const h = (await r.json()) as { ok?: boolean; authRequired?: boolean; name?: string };
      if (!h.ok) throw new Error("not a gitnut daemon");
      if (h.authRequired && !token.trim()) throw new Error("This daemon needs its access token (gitnut token).");
      const server = { url: normalizeUrl(u), token: token.trim() || undefined };
      (onAdd ?? addServer)(server);
      onClose();
    } catch (err) {
      setError(`Can't reach a gitnut daemon at ${u}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Add server" onClose={onClose}>
      <form className="gitnut-form" onSubmit={submit}>
        <Field label="Address">
          <input className={cx("input", "gitnut-input")} autoFocus placeholder="my-box:7420 or https://host" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Access token">
          <input className={cx("input", "gitnut-input")} type="password" placeholder="Output of gitnut token on that machine" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        {error && <div className="gitnut-error-text">{error}</div>}
        <div className="gitnut-form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!url.trim()}>
            Add server
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
