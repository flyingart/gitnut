import { useEffect, useState } from "react";
import type { UpdateInfo } from "@gitnut/commons";

// Bridge to the GitNut desktop app around this page (Tauri). The app gives its own daemon's page
// three commands (src-tauri/capabilities/local-daemon.json); everywhere else this is null.
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const ipc = (globalThis as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;

export const desktopApp = ipc
  ? {
      version: () => ipc.invoke("desktop_version") as Promise<string>,
      checkUpdate: () => ipc.invoke("desktop_update_check") as Promise<UpdateInfo>,
      /** Downloads, verifies and installs the update found by checkUpdate, then the app relaunches. */
      installUpdate: () => ipc.invoke("desktop_update_install") as Promise<void>,
    }
  : null;

/** The desktop app's version, or null outside the app. */
export function useDesktopVersion(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    void desktopApp?.version().then(setV, () => {});
  }, []);
  return v;
}
