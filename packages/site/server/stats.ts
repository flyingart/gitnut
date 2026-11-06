// Server-side download statistics in Rybbit: every release file the site hands out (browser
// download, install script, CLI or desktop self-update) becomes a `file_download` event, and each
// install script fetch an `install_script` event. Rybbit gets the visitor's IP and user agent for
// country / device and a daily-salted visitor ID; the raw IP is not stored (see /privacy).
// Off unless GITNUT_RYBBIT_URL, GITNUT_RYBBIT_SITE_ID and GITNUT_RYBBIT_API_KEY are set.
import { DESKTOP_ASSETS, releaseFiles } from "@gitnut/commons";

export type Track = (req: Request, ip: string | undefined, event: string, props: Record<string, string>) => void;

/** Who asked: the desktop app's updater, a daemon updating itself, an install script / CLI, or a browser. */
export function sourceOf(userAgent: string): string {
  if (/tauri|reqwest/i.test(userAgent)) return "desktop-app";
  if (/^Bun\//i.test(userAgent)) return "daemon";
  if (/curl|wget|powershell/i.test(userAgent)) return "cli";
  return userAgent ? "browser" : "unknown";
}

/** Manifest key (`linux-x64`, `desktop-darwin-arm64`, ...) of a release file, or "other". */
export function platformOf(file: string, version: string): string {
  for (const [key, f] of Object.entries(releaseFiles(version))) if (f === file) return key;
  for (const a of DESKTOP_ASSETS) if (a.updater?.file(version) === file) return `${a.key}-update`;
  return "other";
}

export function createTracker(env: Record<string, string | undefined>, canonical: string, fetchImpl: typeof fetch): Track {
  const url = env.GITNUT_RYBBIT_URL?.trim().replace(/\/+$/, "");
  const site = env.GITNUT_RYBBIT_SITE_ID?.trim();
  const key = env.GITNUT_RYBBIT_API_KEY?.trim();
  if (!url || !site || !key) return () => {};
  const hostname = new URL(canonical).hostname;
  return (req, ip, event, props) => {
    const pathname = new URL(req.url).pathname;
    // behind Cloudflare the visitor is cf-connecting-ip; otherwise the first forwarded hop or the socket
    const visitor = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ip;
    const body = {
      site_id: site,
      type: "custom_event",
      event_name: event,
      hostname,
      pathname,
      properties: JSON.stringify(props),
      user_agent: req.headers.get("user-agent") ?? undefined,
      ip_address: visitor || undefined,
      referrer: req.headers.get("referer") ?? undefined,
    };
    // fire and forget: a slow or failing analytics server must never slow a download
    void fetchImpl(`${url}/api/track`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  };
}
