// GitHub releases as the single source of truth for the site: versions, files, checksums, changelog.

export type ChangeType = "new" | "improved" | "fixed";

export interface Release {
  /** Tag without a leading "v". */
  version: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  publishedAt: string;
  /** First line of the notes, for the update manifest. */
  summary: string;
  items: { type: ChangeType; text: string }[];
  /** File name -> download URLs: public browser URL and API URL (works with a token on private repos). */
  assets: Record<string, { url: string; api: string }>;
}

interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string; url: string; browser_download_url: string }[];
}

const HEADING: Record<string, ChangeType> = { new: "new", added: "new", features: "new", improved: "improved", changed: "improved", fixed: "fixed", fixes: "fixed" };

/**
 * Release notes markdown to changelog items. `## New` / `### Improved` / `### Fixed` (also Added,
 * Changed, Fixes) headings group the `-` / `*` bullets below them; bullets before any heading are "new".
 */
export function parseNotes(body: string): Release["items"] {
  const items: Release["items"] = [];
  let type: ChangeType = "new";
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      type = HEADING[h[1].toLowerCase().replace(/[^a-z]/g, "")] ?? type;
      continue;
    }
    const b = /^[-*]\s+(.+)$/.exec(line);
    if (b) items.push({ type, text: b[1].trim() });
  }
  return items;
}

/** Published, non-prerelease releases, newest first. */
export async function fetchReleases(repo: string, token: string | undefined, fetchImpl: typeof fetch): Promise<Release[]> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "gitnut-site", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub releases of ${repo}: HTTP ${res.status}`);
  const list = (await res.json()) as GhRelease[];
  return list
    .filter((r) => !r.draft && !r.prerelease && r.published_at)
    .map((r) => {
      const body = r.body ?? "";
      const items = parseNotes(body);
      return {
        version: r.tag_name.replace(/^v/, ""),
        title: r.name?.trim() || r.tag_name,
        date: r.published_at!.slice(0, 10),
        publishedAt: r.published_at!,
        summary: items[0]?.text ?? (r.name?.trim() || ""),
        items,
        assets: Object.fromEntries(r.assets.map((a) => [a.name, { url: a.browser_download_url, api: a.url }])),
      };
    })
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

/**
 * Download a release file. Public repos: a redirect to GitHub. With a token (private repo): stream it
 * through the site, following GitHub's redirect to storage without forwarding the token.
 */
export async function assetResponse(asset: { url: string; api: string }, token: string | undefined, fetchImpl: typeof fetch): Promise<Response> {
  if (!token) return Response.redirect(asset.url, 302);
  const first = await fetchImpl(asset.api, {
    headers: { accept: "application/octet-stream", authorization: `Bearer ${token}`, "user-agent": "gitnut-site" },
    redirect: "manual",
  });
  const location = first.headers.get("location");
  const res = first.status >= 300 && first.status < 400 && location ? await fetchImpl(location) : first;
  if (!res.ok) return new Response("download failed", { status: 502 });
  return new Response(res.body, {
    headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=300", ...(res.headers.get("content-length") ? { "content-length": res.headers.get("content-length")! } : {}) },
  });
}
