import pkg from "../package.json";

// Replaced by the web build with the release version (packages/web/vite.config.ts).
declare const __GITNUT_VERSION__: string;

/** Version of this client build: the release version it was built for, else package.json. */
export const CLIENT_VERSION: string = typeof __GITNUT_VERSION__ === "string" ? __GITNUT_VERSION__ : pkg.version;
