import { useState } from "react";
import { fetchHealth, parseServerAddress, type ServerConfig } from "./connection";
import { useServers } from "./provider";
import { Dialog, Button } from "./ui";
import { useCx } from "./root";
import { Field } from "./form";

/** A reachable daemon that needs something from the user (shown as is). */
class Hint extends Error {}

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
    let u: string;
    try {
      u = parseServerAddress(url);
    } catch {
      return setError(`Not an address: ${url}`);
    }
    setBusy(true);
    setError(null);
    try {
      const h = await fetchHealth(u);
      if (!h) throw new Error("no gitnut daemon answered");
      if (h.authRequired && !token.trim()) throw new Hint("This daemon needs its access token: run `gitnut token` on that machine and paste it here.");
      // auth off there: only its own page may connect without a token, other apps need the token
      if (h.originAllowed === false && !token.trim()) {
        throw new Hint("This daemon has the access token turned off, so only its own page can connect without it. Run `gitnut token` on that machine and paste the token here (better: also turn auth on there with `gitnut config set auth.enabled true`).");
      }
      const server = { url: u, token: token.trim() || undefined };
      (onAdd ?? addServer)(server);
      onClose();
    } catch (err) {
      setError(err instanceof Hint ? err.message : `Can't reach a gitnut daemon at ${u}: ${(err as Error).message}`);
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
