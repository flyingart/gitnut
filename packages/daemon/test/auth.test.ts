import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, bearer, startDaemon, tmp } from "./helpers";
import { pickTailscaleIp, resolveBind } from "../src/net";
import { hostAllowed } from "../src/auth";
import { hostname } from "node:os";
import { Daemon } from "../src/server";

type Env = Awaited<ReturnType<typeof startDaemon>>;
const fails = (url: string, init?: any) =>
  Client.connect(url, init).then(
    (c) => (c.close(), "connected"),
    (e) => e.message,
  );

describe("auth", () => {
  let env: Env;
  beforeAll(async () => {
    env = await startDaemon();
  });
  afterAll(() => env.d.stop());

  test("R-DAEMON-5: health needs no auth and allows CORS", async () => {
    const res = await fetch(`${env.url}/api/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ ok: true, protocol: 1, authRequired: true });
  });

  test("R-DAEMON-5: health tells a page whether it may connect without a token", async () => {
    const health = (origin?: string) => fetch(`${env.url}/api/health`, { headers: origin ? { origin } : {} }).then((r) => r.json());
    expect((await health()).originAllowed).toBe(true); // not a browser
    expect((await health(env.url)).originAllowed).toBe(true); // its own page
    expect((await health("http://127.0.0.1:1")).originAllowed).toBe(false); // e.g. the desktop app of another machine
  });

  test("R-DAEMON-5: no token and wrong token are rejected", async () => {
    expect((await fetch(`${env.url}/ws`, { headers: { upgrade: "websocket" } })).status).toBe(401);
    expect(await fails(env.wsUrl)).not.toBe("connected");
    expect(await fails(env.wsUrl, bearer("x".repeat(43)))).not.toBe("connected");
    expect((await fetch(`${env.url}/api/rpc`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  test("R-DAEMON-5: subprotocol and Authorization bearer work from any origin", async () => {
    const c = await Client.connect(env.wsUrl, { ...bearer(env.token), headers: { origin: "https://evil.example" } });
    expect(c.ws.protocol).toBe("gitnut.v1");
    expect((await c.call("server.info")).protocol).toBe(1);
    c.close();
    const c2 = await Client.connect(env.wsUrl, { headers: { authorization: `Bearer ${env.token}` } });
    c2.close();
    const r = await fetch(`${env.url}/api/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.token}` },
      body: JSON.stringify({ method: "settings.get" }),
    });
    expect((await r.json()).result.port).toBe(0);
  });

  test("R-DAEMON-5: cookie works only from allowed origins", async () => {
    const cookie = `gitnut_token=${env.token}`;
    const host = new URL(env.url).host;
    const ok = await Client.connect(env.wsUrl, { headers: { cookie, origin: `http://${host}` } });
    ok.close();
    expect(await fails(env.wsUrl, { headers: { cookie } })).toBe("connected"); // non-browser: no Origin
    expect(await fails(env.wsUrl, { headers: { cookie, origin: "tauri://localhost" } })).toBe("connected");
    expect(await fails(env.wsUrl, { headers: { cookie, origin: "https://evil.example" } })).not.toBe("connected");
    expect((await fetch(`${env.url}/ws`, { headers: { cookie, origin: "https://evil.example" } })).status).toBe(403);
    await env.d.updateSettings({ allowedOrigins: ["https://host.example"] });
    expect(await fails(env.wsUrl, { headers: { cookie, origin: "https://host.example" } })).toBe("connected");
  });

  test("R-DAEMON-5: login sets an HttpOnly cookie, ?token= redirects and sets it", async () => {
    const bad = await fetch(`${env.url}/api/login`, { method: "POST", body: JSON.stringify({ token: "nope" }) });
    expect(bad.status).toBe(401);
    const good = await fetch(`${env.url}/api/login`, { method: "POST", body: JSON.stringify({ token: env.token }) });
    expect(good.headers.get("set-cookie")).toBe(`gitnut_token=${env.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`);
    const secure = await fetch(`${env.url}/api/login`, {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ token: env.token }),
    });
    expect(secure.headers.get("set-cookie")).toEndWith("; Secure");
    const red = await fetch(`${env.url}/repo/x?token=${env.token}&view=log`, { redirect: "manual" });
    expect(red.status).toBe(302);
    expect(red.headers.get("location")).toBe("/repo/x?view=log");
    expect(red.headers.get("set-cookie")).toContain(`gitnut_token=${env.token}`);
    const wrong = await fetch(`${env.url}/?token=wrong`, { redirect: "manual" });
    expect(wrong.status).toBe(302);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const out = await fetch(`${env.url}/api/logout`, { method: "POST" });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("R-DAEMON-5: rotating the token disconnects old sessions and returns the new token once", async () => {
    const old = await Client.connect(env.wsUrl, bearer(env.token));
    const cookieSession = await Client.connect(env.wsUrl, { headers: { cookie: `gitnut_token=${env.token}` } });
    const r = await old.call("settings.update", { patch: { auth: { rotateToken: true } } });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await old.closed).code).toBe(4001);
    expect((await cookieSession.closed).code).toBe(4001);
    expect(await fails(env.wsUrl, bearer(env.token))).not.toBe("connected");
    const fresh = await Client.connect(env.wsUrl, bearer(r.token));
    expect(JSON.stringify(await fresh.call("settings.get"))).not.toContain(r.token);
    fresh.close();
    env.token = r.token;
  });

  test("R-DAEMON-5: auth off allows no-token access with the Origin check", async () => {
    const c = await Client.connect(env.wsUrl, bearer(env.token));
    await c.call("settings.update", { patch: { auth: { enabled: false } } });
    expect(await fails(env.wsUrl)).toBe("connected");
    expect(await fails(env.wsUrl, { headers: { origin: "https://evil.example" } })).not.toBe("connected");
    // Turning auth back on drops sessions without a token.
    const anon = await Client.connect(env.wsUrl);
    await c.call("settings.update", { patch: { auth: { enabled: true } } });
    expect((await anon.closed).code).toBe(4001);
    c.close();
  });

  test("R-DAEMON-5: auth off on a public bind is refused without force", async () => {
    const c = await Client.connect(env.wsUrl, bearer(env.token));
    const r = await c.send("settings.update", { patch: { bind: "all", auth: { enabled: false } } });
    expect(r.error.code).toBe("bad_request");
    expect(r.error.message).toContain("force");
    expect(env.d.cfg.settings.bind).toBe("localhost");
    c.close();
    const home = tmp();
    const d = new Daemon({ home, overrides: { port: 0, bind: "all" }, log: () => {} });
    d.cfg.settings.auth.enabled = false;
    expect(d.start()).rejects.toThrow("force");
    const forced = new Daemon({ home, overrides: { port: 0, bind: "all" }, force: true, log: () => {} });
    forced.cfg.settings.auth.enabled = false;
    forced.cfg.settings.update.autoCheck = false;
    await forced.start();
    expect(forced.listen).toStartWith("0.0.0.0:");
    expect(forced.url).toStartWith("http://127.0.0.1:");
    await forced.stop();
  });
});

describe("web client", () => {
  test("R-DAEMON-3: serves the web build with SPA fallback and cache headers", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
    writeFileSync(join(dir, "assets", "app-abc12345.js"), "console.log(1)");
    process.env.GITNUT_WEB_DIR = dir;
    const env = await startDaemon();
    try {
      const index = await fetch(`${env.url}/`);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect(index.headers.get("cache-control")).toBe("no-cache");
      expect(await index.text()).toContain("root");
      const js = await fetch(`${env.url}/assets/app-abc12345.js`);
      expect(js.headers.get("content-type")).toContain("javascript");
      expect(js.headers.get("cache-control")).toContain("immutable");
      expect(await (await fetch(`${env.url}/some/client/route`)).text()).toContain("root");
      expect((await fetch(`${env.url}/missing.js`)).status).toBe(404);
      expect(await (await fetch(`${env.url}/..%2f..%2fetc/passwd`)).text()).not.toContain("root:");
      expect(await (await fetch(`${env.url}/..%2f..%2fetc/hosts.txt`)).text()).toBe("not found");
      // Turning serveWeb off restarts the listener: / is 404 but the API keeps working.
      await env.d.updateSettings({ serveWeb: false });
      await Bun.sleep(600);
      expect((await fetch(`${env.d.url}/`)).status).toBe(404);
      expect((await fetch(`${env.d.url}/api/health`)).status).toBe(200);
      const c = await Client.connect(env.d.url.replace("http", "ws") + "/ws", bearer(env.token));
      c.close();
    } finally {
      delete process.env.GITNUT_WEB_DIR;
      await env.d.stop();
    }
  });

  test("R-DAEMON-3: --no-web override and the not-built page", async () => {
    process.env.GITNUT_WEB_DIR = join(tmp(), "nothing");
    const env = await startDaemon();
    expect(await (await fetch(`${env.url}/`)).text()).toContain("isn't built");
    await env.d.stop();
    delete process.env.GITNUT_WEB_DIR;
    const off = await startDaemon({}, { serveWeb: false });
    expect((await fetch(`${off.url}/`)).status).toBe(404);
    expect(off.d.cfg.settings.serveWeb).toBe(true); // override is for this run only
    await off.d.stop();
  });
});

describe("bind modes", () => {
  const iface = (address: string, internal = false) => ({ address, family: "IPv4", internal, netmask: "", mac: "", cidr: null }) as any;

  test("R-DAEMON-4: tailscale IP picker prefers the tailscale interface and the 100.64/10 range", () => {
    expect(pickTailscaleIp({ eth0: [iface("10.0.0.2")], tailscale0: [iface("100.101.102.103")] })).toBe("100.101.102.103");
    expect(pickTailscaleIp({ utun3: [iface("100.101.1.2")], en0: [iface("192.168.1.2")] })).toBe("100.101.1.2");
    expect(pickTailscaleIp({ wg0: [iface("100.64.0.9")], Tailscale: [iface("100.100.3.4")] })).toBe("100.100.3.4");
    expect(pickTailscaleIp({ eth0: [iface("100.128.0.1"), iface("100.63.0.1")] })).toBeNull();
    expect(pickTailscaleIp({ lo: [iface("127.0.0.1", true)] })).toBeNull();
  });

  test("R-DAEMON-4: bind modes resolve to listen addresses", () => {
    expect(resolveBind("localhost")).toBe("127.0.0.1");
    expect(resolveBind("all")).toBe("0.0.0.0");
    expect(resolveBind("10.1.2.3")).toBe("10.1.2.3");
    // depends on the machine: a Tailscale IP when Tailscale runs (dev boxes), a clear error otherwise (CI)
    if (pickTailscaleIp(networkInterfaces())) expect(resolveBind("tailscale")).toMatch(/^100\./);
    else expect(() => resolveBind("tailscale")).toThrow(/no Tailscale IPv4/);
  });
});

describe("browser protections (default: auth off, localhost)", () => {
  let open: Awaited<ReturnType<typeof startDaemon>>;
  beforeAll(async () => {
    open = await startDaemon({ auth: { enabled: false, token: "t".repeat(43) } });
  });
  afterAll(() => open.d.stop());
  const rpc = (headers: Record<string, string>) =>
    fetch(`${open.url}/api/rpc`, { method: "POST", headers: { "content-type": "text/plain", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "settings.get" }) });

  test("R-DAEMON-5: DNS rebinding: a foreign host name gets no token-free access", async () => {
    const port = new URL(open.url).port;
    expect((await rpc({ host: `evil.test:${port}`, origin: `http://evil.test:${port}` })).status).toBe(403);
    expect((await rpc({ host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    // the token still works from anywhere
    expect((await rpc({ host: `evil.test:${port}`, origin: `http://evil.test:${port}`, authorization: `Bearer ${open.token}` })).status).toBe(200);
  });

  test("R-DAEMON-5: host names a website can't point here are accepted, others not", () => {
    const req = (host: string) => new Request("http://x/", { headers: { host } });
    for (const ok of ["127.0.0.1:7420", "[::1]:7420", "localhost:7420", "100.101.102.103:7420", "my-box.tail1234.ts.net:7420", "my-mac.local:7420", `${hostname()}:7420`])
      expect([ok, hostAllowed(req(ok), [])]).toEqual([ok, true]);
    for (const bad of ["evil.test:7420", "gitnut.dev", "127.0.0.1.evil.test"]) expect([bad, hostAllowed(req(bad), [])]).toEqual([bad, false]);
    expect(hostAllowed(req("dash.example.com"), ["https://dash.example.com"])).toBe(true);
  });

  test("R-DAEMON-5: no open redirect after a token link; pages can't be framed by other sites", async () => {
    const res = await fetch(`${open.url}//evil.example/x?token=abc`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/evil.example/x");
    const page = await fetch(`${open.url}/`);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect((await fetch(`${open.url}/%E0%A4%A`)).status).toBe(400);
  });

  test("R-DAEMON-5: health tells other websites nothing about the machine", async () => {
    const foreign = await (await fetch(`${open.url}/api/health`, { headers: { origin: "https://evil.example" } })).json();
    expect(foreign.name).toBeUndefined();
    expect((await (await fetch(`${open.url}/api/health`)).json()).name).toBeTruthy();
  });
});
