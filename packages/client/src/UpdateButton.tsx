import { CloudDownload } from "lucide-react";
import { useUpdate } from "./hooks";
import type { ServerProp } from "./provider";
import { GitnutRoot, type StyleProps } from "./root";
import { Button } from "./ui";

/** Props of {@link UpdateButton}. */
export interface UpdateButtonProps extends StyleProps {
  server?: ServerProp;
  /** Also render "Check for updates" when the daemon is current. Default false (renders nothing then). */
  showWhenCurrent?: boolean;
  size?: "sm" | "md";
  /** Icon only (next to the logo); details in the tooltip. */
  compact?: boolean;
  /** Server name for the tooltip of the compact button. */
  label?: string;
}

/** Checks for and applies daemon updates (the daemon serves the web client, so both update), then follows the restart. */
export function UpdateButton(props: UpdateButtonProps) {
  const { info, phase, message, check, apply } = useUpdate(props.server);
  const working = phase === "checking" || phase === "applying" || phase === "restarting";
  if (!info?.available && !props.showWhenCurrent && phase !== "done" && phase !== "restarting" && phase !== "applying") return null;
  if (props.compact) {
    const tip = info?.available && phase !== "done" ? `Update${props.label ? ` ${props.label}` : ""} ${info.current} → ${info.latest}${info.notes ? `\n${info.notes}` : ""}` : (message ?? "Updating…");
    return (
      <GitnutRoot component="update" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
        <Button variant="primary" size="sm" className="gitnut-update-compact" icon={<CloudDownload size={13} />} busy={working} disabled={!info?.available || phase === "done"} onClick={() => void apply()} title={tip} aria-label={tip} />
      </GitnutRoot>
    );
  }
  return (
    <GitnutRoot component="update" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {info?.available && phase !== "done" ? (
        <Button variant="primary" size={props.size ?? "sm"} icon={<CloudDownload size={13} />} busy={working} onClick={() => void apply()} title={info.notes ?? `Update ${info.current} → ${info.latest}`}>
          Update to {info.latest}
        </Button>
      ) : (
        <Button size={props.size ?? "sm"} busy={working} icon={<CloudDownload size={13} />} onClick={() => void check()}>
          Check for updates
        </Button>
      )}
      {(message || info) && (
        <span className={phase === "error" ? "gitnut-error-text" : "gitnut-muted"} role="status">
          {message ?? (info?.error ? info.error : `gitnut ${info?.current}`)}
        </span>
      )}
    </GitnutRoot>
  );
}
