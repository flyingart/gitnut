import pkg from "../../../package.json";

// Replaced by `bun build --define` in release builds.
declare const GITNUT_VERSION: string;
declare const GITNUT_MANIFEST_URL: string;
declare const GITNUT_DOWNLOAD_BASE_URL: string;

export const VERSION: string = typeof GITNUT_VERSION === "string" ? GITNUT_VERSION : pkg.version;
export const BUILD_MANIFEST_URL: string =
  typeof GITNUT_MANIFEST_URL === "string" ? GITNUT_MANIFEST_URL : (process.env.GITNUT_MANIFEST_URL ?? "");
export const BUILD_DOWNLOAD_BASE_URL: string =
  typeof GITNUT_DOWNLOAD_BASE_URL === "string" ? GITNUT_DOWNLOAD_BASE_URL : (process.env.GITNUT_DOWNLOAD_BASE_URL ?? "");

/** True inside a `bun build --compile` binary. */
export const IS_COMPILED = Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");
