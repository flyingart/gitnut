import pkg from "../package.json";

// Replaced by the web build with the release version (packages/web/vite.config.ts).
declare const __GITNUT_VERSION__: string;

/** Version of this client build: the release version it was built for, else package.json. */
export const CLIENT_VERSION: string = typeof __GITNUT_VERSION__ === "string" ? __GITNUT_VERSION__ : pkg.version;

/** Version of the GitNut desktop app around this page, if any: it opens the client with `?app=<version>`. */
export function desktopAppVersion(): string | null {
  if (typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("app");
  try {
    if (v && /^[\w.+-]{1,32}$/.test(v)) sessionStorage.setItem("gitnut.desktopApp", v);
    return sessionStorage.getItem("gitnut.desktopApp");
  } catch {
    return v;
  }
}
