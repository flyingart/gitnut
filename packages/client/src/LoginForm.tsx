import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useConnection, useConnectionState, type ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { Logo } from "./Logo";
import { Button } from "./ui";

/** Props of {@link LoginForm}. */
export interface LoginFormProps extends StyleProps {
  server?: ServerProp;
  /** Called after a successful login. */
  onSuccess?: () => void;
  /** Render as a card centred in its container (default) or inline. */
  variant?: "screen" | "inline";
}

/** Access token form. Same-origin daemons get a login cookie, others keep the token. */
export function LoginForm(props: LoginFormProps) {
  const cx = useCx();
  const conn = useConnection(props.server);
  const { name, error: connError } = useConnectionState(conn);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conn || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await conn.login(token);
      setToken("");
      props.onSuccess?.();
    } catch (err) {
      setError((err as Error).message === "Wrong token" ? "That token is not valid for this daemon." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const form = (
    <form className={cx("panel", "gitnut-login gitnut-glass")} onSubmit={submit} aria-label="Log in">
      <Logo size={40} />
      <h1 className="gitnut-login-title">Log in to {name || "gitnut"}</h1>
      <p className="gitnut-muted gitnut-login-text">This daemon needs its access token. Print it on that machine with <code>gitnut token</code>.</p>
      {connError && !error && <p className="gitnut-muted gitnut-login-text">{connError}</p>}
      <label className={cx("input", "gitnut-search gitnut-login-input")}>
        <KeyRound size={14} className="gitnut-muted" />
        <input type="password" autoFocus autoComplete="current-password" placeholder="Access token" aria-label="Access token" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      {error && <div className="gitnut-error-text" role="alert">{error}</div>}
      <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!token.trim()} className="gitnut-login-submit">
        Log in
      </Button>
    </form>
  );
  return (
    <GitnutRoot component="login-view" theme={props.theme} className={[props.variant !== "inline" && "gitnut-login-screen", props.className].filter(Boolean).join(" ")} classNames={props.classNames} style={props.style}>
      {form}
    </GitnutRoot>
  );
}
