/**
 * Letterboxd scraper proxy Worker.
 *
 * The Next.js app on Vercel gets CF-challenged on Letterboxd's ratings, likes,
 * and films grid pages (HTTP 403, "Just a moment…"). Requests originating
 * from Cloudflare's own edge network bypass those challenges, so this Worker
 * acts as a thin fetch proxy for Letterboxd-scoped paths.
 *
 * Endpoint:
 *   GET /fetch?path=<letterboxd-path>
 *   Authorization: Bearer <SCRAPER_SECRET>
 *   Optional: Cookie: <accumulated CF session cookies>
 *
 * Returns:
 *   - Status: mirrors Letterboxd
 *   - Body: raw HTML/XML/JSON from Letterboxd
 *   - Header `X-Set-Cookies`: base64(JSON.stringify(<string[]>)) of any
 *     Set-Cookie headers Letterboxd returned, so the caller can accumulate
 *     them across a multi-page scrape.
 *
 * The `path` must start with `/` and stay on the letterboxd.com origin — the
 * Worker only ever hits that host.
 */

export interface Env {
  /** Shared secret required on every request. Set via `wrangler secret put`. */
  SCRAPER_SECRET: string;
}

const LETTERBOXD_ORIGIN = "https://letterboxd.com";

// Mimic a real Chrome 131 on macOS. Cloudflare's bot fingerprinting looks at
// the full header set, not just User-Agent — if the Sec-Ch-Ua client hints
// don't agree with the UA string, the challenge gets served anyway.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://letterboxd.com/",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return plain("Method not allowed", 405);
    }

    // Auth — keeps random strangers from turning this into a free proxy.
    const auth = request.headers.get("Authorization") ?? "";
    if (!env.SCRAPER_SECRET || auth !== `Bearer ${env.SCRAPER_SECRET}`) {
      return plain("Unauthorized", 401);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/fetch") {
      return plain("Not found — use GET /fetch?path=/...", 404);
    }

    const path = url.searchParams.get("path");
    if (!path || !path.startsWith("/")) {
      return plain("Missing or invalid ?path (must start with /)", 400);
    }

    const target = `${LETTERBOXD_ORIGIN}${path}`;
    const callerCookie = request.headers.get("Cookie");

    let resp: Response;
    try {
      resp = await fetch(target, {
        headers: {
          ...BROWSER_HEADERS,
          ...(callerCookie ? { Cookie: callerCookie } : {}),
        },
        redirect: "follow",
      });
    } catch (err) {
      return plain(
        `Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    const body = await resp.text();

    // Forward Letterboxd's Set-Cookie values so the caller can thread CF
    // clearance cookies across subsequent page fetches. We use a custom
    // `X-Set-Cookies` header rather than raw Set-Cookie because browsers
    // (and some fetch runtimes) strip/merge Set-Cookie in transit.
    const respHeaders = new Headers();
    respHeaders.set(
      "Content-Type",
      resp.headers.get("Content-Type") ?? "text/html; charset=utf-8",
    );
    // `getSetCookie()` is available in the Workers runtime (compat date ≥
    // 2023-03-01) but the bundled `@cloudflare/workers-types` lags. Cast
    // through a narrow shape to avoid a hard dependency on newer types.
    const headersWithCookies = resp.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies = headersWithCookies.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      respHeaders.set("X-Set-Cookies", encodeSetCookies(setCookies));
    }

    return new Response(body, {
      status: resp.status,
      headers: respHeaders,
    });
  },
};

function plain(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Encode an array of Set-Cookie strings as base64 JSON. Done this way because
 * cookies can contain characters that btoa() can't handle directly
 * (non-Latin1), so we UTF-8 → Latin1 via encodeURIComponent first.
 */
function encodeSetCookies(cookies: string[]): string {
  const json = JSON.stringify(cookies);
  // UTF-8-safe base64
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
