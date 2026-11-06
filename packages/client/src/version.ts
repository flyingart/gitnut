import pkg from "../package.json";

/** Version of this client build (kept in sync by the release script). */
export const CLIENT_VERSION: string = pkg.version;

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
