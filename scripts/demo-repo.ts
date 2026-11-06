// Small demo repository for screenshots and manual testing: branches, merges, tags, an `origin` remote,
// a second worktree, and uncommitted edits in both worktrees ("agents at work").
//   bun scripts/demo-repo.ts [folder]   (default $GITNUT_FIXTURES or .cache/fixtures)
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AUTHORS = [
  ["Ada Lovelace", "ada@acme.dev"],
  ["Grace Hopper", "grace@acme.dev"],
  ["Claude Agent", "agent@acme.dev"],
  ["Linus Byte", "linus@acme.dev"],
] as const;

let clock = Math.floor(Date.UTC(2026, 8, 1, 9) / 1000);
const env = (who: number) => {
  clock += 3600 * (3 + ((clock / 7) % 9));
  clock = Math.floor(clock);
  const [name, email] = AUTHORS[who % AUTHORS.length];
  const date = `@${clock} +0000`;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
};

function git(cwd: string, args: string[], who = 0) {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...env(who), GIT_CONFIG_NOSYSTEM: "1" }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
}

function write(dir: string, files: Record<string, string | null>) {
  for (const [f, c] of Object.entries(files)) {
    const p = join(dir, f);
    if (c === null) rmSync(p, { force: true });
    else {
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, c);
    }
  }
}

function commit(dir: string, msg: string, files: Record<string, string | null>, who = 0) {
  write(dir, files);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", msg], who);
}

const app = (extra = "") => `import { createServer } from "node:http";
import { router } from "./router";
import { loadConfig } from "./config";

const config = loadConfig(process.env);

export function start(port = config.port) {
  const server = createServer((req, res) => router.handle(req, res));
  server.listen(port, () => console.log(\`acme listening on \${port}\`));${extra}
  return server;
}
`;

const router = (routes: string) => `import type { IncomingMessage, ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

const routes = new Map<string, Handler>([
${routes}
]);

export const router = {
  async handle(req: IncomingMessage, res: ServerResponse) {
    const handler = routes.get(req.url ?? "/");
    if (!handler) {
      res.statusCode = 404;
      return res.end("not found");
    }
    await handler(req, res);
  },
};
`;

const config = (fields: string) => `export interface Config {
  port: number;
  /** Public URL used in emails and redirects. */
  baseUrl: string;${fields}
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT ?? 8080),
    baseUrl: env.BASE_URL ?? "http://localhost:8080",
  };
}
`;

const css = (accent: string, extra = "") => `:root {
  --accent: ${accent};
  --radius: 8px;
  --font: system-ui, sans-serif;
}

body {
  margin: 0;
  font-family: var(--font);
}

.button {
  border-radius: var(--radius);
  background: var(--accent);
  color: white;
}
${extra}`;

export function makeDemoRepo(base: string): { repo: string; worktree: string } {
  const repo = join(base, "acme-web");
  const remote = join(base, "..", "gitnut-fixture-remotes", "acme-web.git");
  const worktree = join(base, "acme-web-dark-mode");
  if (existsSync(repo)) return { repo, worktree };
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(remote, ".."), { recursive: true });
  git(base, ["init", "-q", "--bare", remote]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  commit(repo, "Initial project skeleton", {
    "package.json": `{\n  "name": "acme-web",\n  "version": "0.1.0",\n  "type": "module"\n}\n`,
    "README.md": "# acme-web\n\nThe Acme storefront.\n",
    "src/app.ts": app(),
    "src/router.ts": router(`  ["/", (_req, res) => res.end("hello")],`),
    "src/config.ts": config(""),
    "docs/old.md": "Old setup notes.\n",
  }, 0);
  commit(repo, "Add health check route", { "src/router.ts": router(`  ["/", (_req, res) => res.end("hello")],\n  ["/health", (_req, res) => res.end("ok")],`) }, 1);
  commit(repo, "Styles: base button", { "src/styles/theme.css": css("#3b5bdb") }, 0);
  git(repo, ["tag", "-a", "v0.1.0", "-m", "First preview"], 0);

  git(repo, ["checkout", "-q", "-b", "feature/auth"]);
  commit(repo, "auth: session cookie middleware", { "src/auth/session.ts": `export interface Session {\n  userId: string;\n  expires: number;\n}\n\nexport function parseSession(cookie: string | undefined): Session | null {\n  if (!cookie) return null;\n  const [userId, expires] = cookie.split(".");\n  return Number(expires) > Date.now() ? { userId, expires: Number(expires) } : null;\n}\n` }, 2);
  commit(repo, "auth: login and logout routes", { "src/router.ts": router(`  ["/", (_req, res) => res.end("hello")],\n  ["/health", (_req, res) => res.end("ok")],\n  ["/login", (_req, res) => res.end("login")],\n  ["/logout", (_req, res) => res.end("bye")],`) }, 2);
  git(repo, ["checkout", "-q", "main"]);
  commit(repo, "Config: base URL for redirects", { "src/config.ts": config(`\n  /** Session lifetime in hours. */\n  sessionHours: number;`).replace(`baseUrl: env.BASE_URL ?? "http://localhost:8080",`, `baseUrl: env.BASE_URL ?? "http://localhost:8080",\n    sessionHours: Number(env.SESSION_HOURS ?? 24),`) }, 1);
  git(repo, ["merge", "-q", "--no-ff", "-m", "Merge branch 'feature/auth'", "feature/auth"], 1);

  git(repo, ["checkout", "-q", "-b", "fix/login-redirect"]);
  commit(repo, "Fix redirect loop after login", { "src/auth/redirect.ts": `import type { Config } from "../config";\n\n/** Only redirect to our own origin. */\nexport function safeRedirect(target: string | null, config: Config): string {\n  if (!target) return "/";\n  const url = new URL(target, config.baseUrl);\n  return url.origin === new URL(config.baseUrl).origin ? url.pathname + url.search : "/";\n}\n` }, 3);
  git(repo, ["checkout", "-q", "main"]);
  commit(repo, "Docs: running locally", { "README.md": "# acme-web\n\nThe Acme storefront.\n\n## Run\n\n```sh\nbun install\nbun run dev\n```\n" }, 0);
  git(repo, ["merge", "-q", "--no-ff", "-m", "Merge branch 'fix/login-redirect'", "fix/login-redirect"], 3);
  git(repo, ["tag", "-a", "v1.0.0", "-m", "1.0"], 1);

  git(repo, ["checkout", "-q", "-b", "feature/checkout"]);
  commit(repo, "checkout: cart model", { "src/cart/cart.ts": `export interface CartItem {\n  sku: string;\n  quantity: number;\n  priceCents: number;\n}\n\nexport const total = (items: CartItem[]) => items.reduce((sum, i) => sum + i.quantity * i.priceCents, 0);\n` }, 2);
  commit(repo, "checkout: payment intent stub", { "src/cart/payment.ts": `import { total, type CartItem } from "./cart";\n\nexport async function createIntent(items: CartItem[]) {\n  return { amount: total(items), currency: "eur" };\n}\n` }, 2);
  git(repo, ["checkout", "-q", "main"]);
  commit(repo, "Graceful shutdown on SIGTERM", { "src/app.ts": app(`\n  process.on("SIGTERM", () => server.close());`) }, 1);
  commit(repo, "Bump version to 1.1.0", { "package.json": `{\n  "name": "acme-web",\n  "version": "1.1.0",\n  "type": "module"\n}\n` }, 0);
  git(repo, ["tag", "-a", "v1.1.0", "-m", "1.1"], 0);

  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-q", "origin", "main", "feature/checkout", "--tags"]);
  git(repo, ["branch", "-q", "-u", "origin/main", "main"]);
  commit(repo, "Cache static assets for a year", { "src/static.ts": `export const cacheHeaders = { "cache-control": "public, max-age=31536000, immutable" };\n` }, 3);

  git(repo, ["checkout", "-q", "-b", "feature/dark-mode"]);
  commit(repo, "theme: dark palette tokens", { "src/styles/theme.css": css("#3b5bdb", `\n@media (prefers-color-scheme: dark) {\n  :root {\n    --accent: #748ffc;\n  }\n}\n`) }, 2);
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["worktree", "add", "-q", worktree, "feature/dark-mode"]);

  // uncommitted work in progress (what an agent is doing right now)
  write(repo, {
    "src/app.ts": app(`\n  process.on("SIGTERM", () => server.close());\n  process.on("SIGINT", () => {\n    console.log("shutting down");\n    server.close(() => process.exit(0));\n  });`).replace(`console.log(\`acme listening on \${port}\`)`, `console.log(\`acme listening on \${config.baseUrl}\`)`),
    "src/components/Banner.tsx": `export function Banner({ message }: { message: string }) {\n  return <div className="banner">{message}</div>;\n}\n`,
    "src/config.ts": config(`\n  /** Session lifetime in hours. */\n  sessionHours: number;\n  /** Show the maintenance banner. */\n  maintenance: boolean;`).replace(`baseUrl: env.BASE_URL ?? "http://localhost:8080",`, `baseUrl: env.BASE_URL ?? "http://localhost:8080",\n    sessionHours: Number(env.SESSION_HOURS ?? 24),\n    maintenance: env.MAINTENANCE === "1",`),
    "docs/old.md": null,
  });
  git(repo, ["add", "src/config.ts"]);
  write(worktree, {
    "src/styles/theme.css": css("#3b5bdb", `\n@media (prefers-color-scheme: dark) {\n  :root {\n    --accent: #748ffc;\n    --surface: #101114;\n    --text: #e9ecef;\n  }\n\n  body {\n    background: var(--surface);\n    color: var(--text);\n  }\n}\n`),
    "src/theme/tokens.ts": `export const tokens = {\n  light: { accent: "#3b5bdb", surface: "#ffffff" },\n  dark: { accent: "#748ffc", surface: "#101114" },\n} as const;\n\nexport type Scheme = keyof typeof tokens;\n`,
  });
  return { repo, worktree };
}

if (import.meta.main) {
  const base = process.argv[2] ?? process.env.GITNUT_FIXTURES ?? join(import.meta.dir, "..", ".cache", "fixtures");
  console.log(makeDemoRepo(base));
}
