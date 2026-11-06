import { useEffect, useState } from "react";
import type { UpdateInfo } from "@gitnut/commons";

// Bridge to the GitNut desktop app around this page (Tauri). The app gives its own daemon's page
// its commands (grant_daemon_page in src-tauri/src/lib.rs); everywhere else this is null.
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
const ask = (cmd: string) => () => ipc!.invoke(`plugin:window|${cmd}`, { label: "main" }) as Promise<boolean>;
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

/**
 * Window controls for the app's own title bar: on Windows the app has no native frame
 * (set_decorations in src-tauri/src/lib.rs), so the top bar draws these buttons.
 */
export const desktopWindow =
  ipc && /Windows/i.test(ua) ? { minimize: win("minimize"), toggleMaximize: win("toggle_maximize"), close: win("close"), isMaximized: ask("is_maximized") } : null;

/**
 * macOS: the native title bar is an overlay (titleBarStyle "Overlay" in tauri.conf.json), so the app's
 * top bar runs to the window edge and leaves room for the traffic lights, like T3 Code.
 */
export const desktopMac = ipc && /Macintosh/i.test(ua) ? { isFullscreen: ask("is_fullscreen") } : null;

/**
 * Mark an element as the window's drag area (Tauri's `data-tauri-drag-region`). Tauri also maximizes /
 * restores (macOS: zooms) on double-click there, like a native title bar. A no-op outside the app.
 */
export const dragRegion = desktopWindow || desktopMac ? { "data-tauri-drag-region": "" } : {};

/** Re-reads a window state on every resize (maximize, fullscreen); false outside the app. */
function useWindowState(read: (() => Promise<boolean>) | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!read) return;
    const update = () => void read().then(setOn, () => {});
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [read]);
  return on;
}

/** Whether the app window is maximized (Windows, for the maximize / restore icon). */
export const useWindowMaximized = () => useWindowState(desktopWindow?.isMaximized);

/** macOS: whether the traffic lights sit over the top bar (they hide in fullscreen). */
export const useMacTrafficLights = () => !useWindowState(desktopMac?.isFullscreen) && !!desktopMac;

/** The desktop app's version, or null outside the app. */
export function useDesktopVersion(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    void desktopApp?.version().then(setV, () => {});
  }, []);
  return v;
}
