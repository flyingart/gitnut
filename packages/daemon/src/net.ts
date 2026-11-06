import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { BindMode } from "@gitnut/commons";
import { fail } from "./errors";

const inTailnet = (ip: string) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127; // 100.64.0.0/10 (CGNAT range Tailscale uses)
};

/** Tailscale IPv4 from interfaces, preferring an interface whose name contains "tailscale". */
export function pickTailscaleIp(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const found: { name: string; ip: string }[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && inTailnet(i.address)) found.push({ name, ip: i.address });
  }
  return (found.find((f) => /tailscale/i.test(f.name)) ?? found[0])?.ip ?? null;
}

function tailscaleCli(): string | null {
  try {
    const r = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore", timeout: 3000 });
    const ip = r.stdout.toString().trim().split("\n")[0];
    return r.exitCode === 0 && inTailnet(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** Address to listen on for a bind mode. */
export function resolveBind(bind: BindMode): string {
  if (bind === "localhost") return "127.0.0.1";
  if (bind === "all") return "0.0.0.0";
  if (bind === "tailscale") {
    return pickTailscaleIp(networkInterfaces()) ?? tailscaleCli() ?? fail("bad_request", "bind is tailscale but no Tailscale IPv4 was found (is Tailscale running?)");
  }
  return bind;
}

/** Host a client on this machine uses to reach a listen address. */
export const localHost = (listenHost: string) => (listenHost === "0.0.0.0" || listenHost === "::" ? "127.0.0.1" : listenHost);
export const urlHost = (h: string) => (h.includes(":") ? `[${h}]` : h);
