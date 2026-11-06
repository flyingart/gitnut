import { isIP } from "node:net";
import { hostname } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { AUTH_COOKIE, BEARER_PROTOCOL_PREFIX } from "@gitnut/commons";

export function tokenEquals(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Token from `Authorization: Bearer` or the `gitnut.bearer.<token>` WebSocket subprotocol. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  const protos = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
  const p = protos.find((x) => x.startsWith(BEARER_PROTOCOL_PREFIX));
  return p ? p.slice(BEARER_PROTOCOL_PREFIX.length) : null;
}

const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

/**
 * Host names a website can't make point at this machine, so DNS rebinding (an attacker's domain that
 * suddenly resolves to 127.0.0.1) can't use cookie / no-auth access: IP addresses, localhost, this
 * machine's own names, mDNS (*.local), Tailscale MagicDNS (*.ts.net), and hosts in `allowedOrigins`.
 */
export function hostAllowed(req: Request, allowed: string[]): boolean {
  const raw = (req.headers.get("host") ?? "").toLowerCase();
  const host = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.replace(/:\d+$/, "");
  if (!host || isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".ts.net")) return true;
  const me = hostname().toLowerCase();
  if (host === me || host === me.split(".")[0]) return true;
  return allowed.some((o) => {
    try {
      return new URL(o).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
}

/** Browser origin allowed for cookie / no-auth access: same host:port, `allowedOrigins`, or the desktop app. */
export function originAllowed(req: Request, allowed: string[]): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // not a browser
  if (TAURI_ORIGINS.includes(origin) || allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export type AuthResult = { ok: true; token: string | null } | { ok: false; status: 401 | 403; message: string };

/**
 * Bearer access works from any origin (embedding SDK). Cookie and no-auth access are
 * limited to allowed origins so other websites can't drive a local daemon.
 */
export function authorize(req: Request, auth: { enabled: boolean; token: string }, allowedOrigins: string[]): AuthResult {
  const bearer = bearerToken(req);
  if (bearer !== null && tokenEquals(bearer, auth.token)) return { ok: true, token: bearer };
  const viaCookie = tokenEquals(cookie(req, AUTH_COOKIE), auth.token);
  if (auth.enabled && !viaCookie) return { ok: false, status: 401, message: "unauthorized" };
  if (!originAllowed(req, allowedOrigins)) return { ok: false, status: 403, message: "origin not allowed" };
  if (!hostAllowed(req, allowedOrigins)) return { ok: false, status: 403, message: "host not allowed: use the access token, or add this address to allowedOrigins" };
  return { ok: true, token: viaCookie ? auth.token : null };
}

export function authCookie(token: string, secure: boolean, maxAge = 400 * 86400): string {
  return `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export const isHttps = (req: Request) => req.url.startsWith("https:") || req.headers.get("x-forwarded-proto") === "https";
