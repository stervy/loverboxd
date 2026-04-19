/**
 * Shared Letterboxd-fetching helper for Next.js API routes.
 *
 * Letterboxd's Cloudflare WAF returns 403 "Just a moment…" challenges for
 * requests from Vercel's AWS IPs on ratings/likes/films grid pages. To get
 * around it, we route requests through a Cloudflare Worker (see /worker in
 * this repo) — requests from CF's own edge network aren't challenged.
 *
 * Routing rule:
 *   - Both SCRAPER_WORKER_URL and SCRAPER_WORKER_SECRET set → Worker proxy.
 *   - Either missing → direct fetch (works locally on residential IPs and
 *     for CF-unchallenged paths like the profile page and RSS feed).
 */

const LETTERBOXD_ORIGIN = "https://letterboxd.com";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://letterboxd.com/",
};

/**
 * Fetch a letterboxd.com path as HTML/text, threading CF cookies through the
 * provided `cookies` array. Mutates `cookies` by appending any Set-Cookie
 * values from the response so the caller can reuse accumulated session
 * cookies across multi-page scrapes.
 *
 * `path` must start with "/". Include pagination/query params directly in the
 * path string (e.g. `/user/films/ratings/page/2/`).
 */
export async function fetchLetterboxd(
  path: string,
  cookies: string[],
): Promise<string> {
  const workerUrl = process.env.SCRAPER_WORKER_URL;
  const workerSecret = process.env.SCRAPER_WORKER_SECRET;

  if (workerUrl && workerSecret) {
    return fetchViaWorker(path, cookies, workerUrl, workerSecret);
  }
  return fetchDirect(path, cookies);
}

async function fetchDirect(path: string, cookies: string[]): Promise<string> {
  const cookieHeader = cookies.join("; ");
  const resp = await fetch(`${LETTERBOXD_ORIGIN}${path}`, {
    headers: {
      ...BROWSER_HEADERS,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: "follow",
  });
  const setCookie = resp.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) cookies.push(c.split(";")[0]);
  return resp.text();
}

async function fetchViaWorker(
  path: string,
  cookies: string[],
  workerUrl: string,
  secret: string,
): Promise<string> {
  const cookieHeader = cookies.join("; ");
  const url = `${workerUrl.replace(/\/$/, "")}/fetch?path=${encodeURIComponent(path)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  // The Worker encodes upstream Set-Cookie values as a base64 JSON array on
  // `X-Set-Cookies` (regular Set-Cookie would be stripped/merged by fetch).
  const encoded = resp.headers.get("X-Set-Cookies");
  if (encoded) {
    try {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const json = new TextDecoder().decode(bytes);
      const arr = JSON.parse(json) as string[];
      for (const c of arr) cookies.push(c.split(";")[0]);
    } catch {
      // Malformed cookie header — not fatal, just means no session carry-over.
    }
  }

  return resp.text();
}

/**
 * Convenience: whether the Worker proxy is configured. Callers can use this
 * to gate log messages or fallback strategies, but don't need to — the
 * fetchLetterboxd function handles the branching internally.
 */
export function isWorkerProxyConfigured(): boolean {
  return Boolean(process.env.SCRAPER_WORKER_URL && process.env.SCRAPER_WORKER_SECRET);
}
