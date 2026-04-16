import { NextRequest } from "next/server";
import { getCached, setCache } from "../cache";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

/**
 * Resolve a Letterboxd short URL (e.g. https://boxd.it/hTha) to its film slug
 * by following the 302 redirect. Returns null if resolution fails.
 */
async function resolveShortUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: HEADERS,
    });
    // Expect a 3xx with Location header
    const location = resp.headers.get("location");
    if (!location) return null;
    const m = location.match(/\/film\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { urls?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const urls = body.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 100) {
    return Response.json({ error: "Provide 1-100 urls" }, { status: 400 });
  }

  // Only accept boxd.it short URLs to prevent SSRF
  const safe = urls.map((u) => typeof u === "string" && /^https?:\/\/boxd\.it\/[\w-]+\/?$/.test(u.trim()) ? u.trim() : null);

  // Check cache + collect uncached indices
  const slugs: (string | null)[] = new Array(urls.length).fill(null);
  const toFetch: { idx: number; url: string }[] = [];
  for (let i = 0; i < safe.length; i++) {
    const u = safe[i];
    if (!u) continue;
    const cached = getCached<string>(`boxd:${u}`);
    if (cached) {
      slugs[i] = cached;
    } else {
      toFetch.push({ idx: i, url: u });
    }
  }

  // Fetch uncached with concurrency limit (10 at a time)
  const CONCURRENCY = 10;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async ({ idx, url }) => ({ idx, url, slug: await resolveShortUrl(url) }))
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        const { idx, url, slug } = r.value;
        if (slug) {
          slugs[idx] = slug;
          setCache(`boxd:${url}`, slug, "film-details");
        }
      }
    }
  }

  return Response.json({ slugs });
}
