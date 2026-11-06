import pkg from "../../../package.json";

// Replaced by `bun build --define` in release builds.
declare const GITNUT_VERSION: string;
declare const GITNUT_SITE_URL: string;

export const VERSION: string = typeof GITNUT_VERSION === "string" ? GITNUT_VERSION : pkg.version;
/** Website the binary was built for; its /manifest.json lists the updates and their download URLs. */
// Build time only: a dev daemon (bun src/cli.ts) never checks the public site for updates.
const SITE_URL: string = (typeof GITNUT_SITE_URL === "string" ? GITNUT_SITE_URL : "").replace(/\/+$/, "");
export const BUILD_MANIFEST_URL: string = SITE_URL ? `${SITE_URL}/manifest.json` : "";

/** True inside a `bun build --compile` binary. */
export const IS_COMPILED = Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");
