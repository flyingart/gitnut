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

const win = (cmd: string) => () => ipc!.invoke(`plugin:window|${cmd}`, { label: "main" }) as Promise<void>;

/**
 * Window controls for the app's own title bar: on Windows the app has no native frame
 * (tauri.windows.conf.json), so the top bar becomes the drag area and draws these buttons.
 */
export const desktopWindow =
  ipc && typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? { minimize: win("minimize"), toggleMaximize: win("toggle_maximize"), close: win("close") }
    : null;

/** Mark an element as the window's drag area (Tauri's `data-tauri-drag-region`); a no-op outside the app. */
export const dragRegion = desktopWindow ? { "data-tauri-drag-region": "" } : {};

/** The desktop app's version, or null outside the app. */
export function useDesktopVersion(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    void desktopApp?.version().then(setV, () => {});
  }, []);
  return v;
}
