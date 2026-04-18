import { NextRequest } from "next/server";
import { getCached, setCache } from "../cache";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://letterboxd.com/",
};

interface FilmDetail {
  slug: string;
  directors: string[];
  genres: string[];
  actors: string[];
  runtime?: number;
  countries?: string[];
  // Themes — merged Letterboxd themes, mini-themes, and nanogenres (deduped,
  // first-seen order). Absent for older/obscure films that Letterboxd hasn't
  // tagged.
  themes?: string[];
  // Letterboxd weighted average rating, 0.5–5.0. Absent for films too new or
  // obscure to have one.
  avgRating?: number;
  // Total members who logged / liked the film (from /csi/film/{slug}/stats/).
  watchedCount?: number;
  likesCount?: number;
  // TMDB enrichment — present when the Letterboxd page linked to TMDB and
  // the TMDB API returned usable metadata. All optional; UI degrades to text.
  tmdbId?: number;
  tmdbType?: "movie" | "tv";
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  tagline?: string;
}

/**
 * Minimal subset of the TMDB /movie/{id} or /tv/{id} response. We only store
 * what we actually render so the cache stays small.
 */
interface TMDBMeta {
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  tagline?: string;
}

/**
 * Fetch poster/backdrop metadata from TMDB for a single film. Bearer token
 * lives in env so it never reaches the client. Cached for 30 days under the
 * TMDB id (not the Letterboxd slug) so multiple users who rated the same film
 * share the cache hit. Returns null on any error — UI falls back to text.
 */
async function fetchTMDBMeta(
  tmdbId: number,
  tmdbType: "movie" | "tv"
): Promise<TMDBMeta | null> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return null;

  const cacheKey = `tmdb:${tmdbType}:${tmdbId}`;
  const cached = getCached<TMDBMeta>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      poster_path?: string | null;
      backdrop_path?: string | null;
      overview?: string;
      tagline?: string;
    };
    const meta: TMDBMeta = {
      posterPath: json.poster_path ?? undefined,
      backdropPath: json.backdrop_path ?? undefined,
      overview: json.overview || undefined,
      tagline: json.tagline || undefined,
    };
    // "film-details" TTL is 24h; TMDB data rarely changes but we piggyback
    // on the existing tier rather than introducing a separate one.
    setCache(cacheKey, meta, "film-details");
    return meta;
  } catch {
    return null;
  }
}

function parseFilmPage(html: string, slug: string): FilmDetail {
  const directors: string[] = [];
  const genres: string[] = [];
  const actors: string[] = [];

  // Directors — href="/director/name/"
  const dirMatches = html.matchAll(
    /href="\/director\/[^"]*"[^>]*>([^<]+)</g
  );
  const seenDirs = new Set<string>();
  for (const m of dirMatches) {
    const name = m[1].trim();
    if (name && !seenDirs.has(name)) {
      seenDirs.add(name);
      directors.push(name);
    }
  }

  // Genres — href="/films/genre/name/"
  const genreMatches = html.matchAll(
    /href="\/films\/genre\/[^"]*"[^>]*>([^<]+)</g
  );
  for (const m of genreMatches) {
    const name = m[1].trim();
    if (name && !genres.includes(name)) genres.push(name);
  }

  // Actors — href="/actor/name/"
  const actorMatches = html.matchAll(
    /href="\/actor\/[^"]*"[^>]*>([^<]+)</g
  );
  for (const m of actorMatches) {
    const name = m[1].trim();
    if (name && !actors.includes(name)) actors.push(name);
  }

  // Runtime — Letterboxd renders it as "148&nbsp;mins" in the text-footer block
  let runtime: number | undefined;
  const runtimeMatch = html.match(/(\d+)&nbsp;mins/);
  if (runtimeMatch) {
    runtime = parseInt(runtimeMatch[1], 10);
  }

  // Countries — href="/films/country/xx/"
  const countries: string[] = [];
  const countryMatches = html.matchAll(
    /href="\/films\/country\/[^"]*"[^>]*>([^<]+)</g
  );
  for (const m of countryMatches) {
    const name = m[1].trim();
    if (name && !countries.includes(name)) countries.push(name);
  }

  // Themes — Letterboxd tags films with themes (/films/theme/), mini-themes
  // (/films/mini-theme/), and nanogenres (/films/nanogenre/). Nanogenres are
  // the fine-grained AI-clustered tags like "Twisted dark psychological
  // thriller". We merge all three into a single themes list, deduped.
  const themes: string[] = [];
  const themeMatches = html.matchAll(
    /href="\/films\/(?:theme|mini-theme|nanogenre)\/[^"]*"[^>]*>([^<]+)</g
  );
  for (const m of themeMatches) {
    const name = m[1].trim();
    if (name && !themes.includes(name)) themes.push(name);
  }

  // Average rating — Letterboxd embeds JSON-LD with "ratingValue". Some
  // newer/obscure films have no rating yet, so this is optional.
  let avgRating: number | undefined;
  const ratingMatch = html.match(/"ratingValue"\s*:\s*([\d.]+)/);
  if (ratingMatch) {
    const parsed = parseFloat(ratingMatch[1]);
    if (!Number.isNaN(parsed) && parsed > 0) avgRating = parsed;
  } else {
    // Fallback — twitter card data
    const twitterMatch = html.match(
      /name="twitter:data2"\s+content="([\d.]+)\s+out of 5"/
    );
    if (twitterMatch) {
      const parsed = parseFloat(twitterMatch[1]);
      if (!Number.isNaN(parsed) && parsed > 0) avgRating = parsed;
    }
  }

  // TMDB id — Letterboxd embeds an outbound link to themoviedb.org in the
  // footer of every film page. We match either /movie/ID or /tv/ID.
  let tmdbId: number | undefined;
  let tmdbType: "movie" | "tv" | undefined;
  const tmdbMatch = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  if (tmdbMatch) {
    tmdbType = tmdbMatch[1] as "movie" | "tv";
    tmdbId = parseInt(tmdbMatch[2], 10);
  }

  return {
    slug,
    directors,
    genres,
    actors,
    runtime,
    countries,
    themes,
    avgRating,
    tmdbId,
    tmdbType,
  };
}

/**
 * Fetch watch/like counts from Letterboxd's stats fragment. This is a separate
 * endpoint from the film page itself and returns a small HTML fragment with
 * tooltip-style `data-original-title` attributes containing the totals. Both
 * counts are optional — some films may have zero likes and the regex simply
 * won't match. Returns null on network errors so the main scrape keeps going.
 */
async function fetchFilmStats(
  slug: string
): Promise<{ watchedCount?: number; likesCount?: number } | null> {
  try {
    const resp = await fetch(
      `https://letterboxd.com/csi/film/${encodeURIComponent(slug)}/stats/`,
      { headers: HEADERS }
    );
    if (!resp.ok) return null;
    const html = await resp.text();
    if (html.includes("Just a moment")) return null;

    // "Watched by 1,234,567 members" — strip commas before parsing.
    const watchMatch = html.match(
      /Watched by\s+<strong>([\d,]+)<\/strong>|Watched by\s+([\d,]+)\s+members?/i
    );
    const likeMatch = html.match(
      /Liked by\s+<strong>([\d,]+)<\/strong>|Liked by\s+([\d,]+)\s+members?/i
    );

    const parse = (raw: string | undefined): number | undefined => {
      if (!raw) return undefined;
      const n = parseInt(raw.replace(/,/g, ""), 10);
      return Number.isNaN(n) ? undefined : n;
    };

    return {
      watchedCount: parse(watchMatch?.[1] ?? watchMatch?.[2]),
      likesCount: parse(likeMatch?.[1] ?? likeMatch?.[2]),
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { slugs?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slugs = body.slugs;
  if (!Array.isArray(slugs) || slugs.length === 0 || slugs.length > 15) {
    return Response.json(
      { error: "Provide 1-15 slugs" },
      { status: 400 }
    );
  }

  // Check cache for each slug, only fetch uncached ones. The cache key is
  // versioned (v2) because we added themes/avgRating/watch+like fields — older
  // entries without them would render blank sections, so we invalidate them.
  const results: FilmDetail[] = [];
  const uncachedSlugs: string[] = [];

  for (const slug of slugs) {
    const cached = getCached<FilmDetail>(`film:v2:${slug}`);
    if (cached) {
      results.push(cached);
    } else {
      uncachedSlugs.push(slug);
    }
  }

  // Fetch uncached film pages in parallel (max 5 concurrent). For each film we
  // ALSO fire off the stats fragment fetch (watch/like counts) in parallel with
  // the page scrape, and the TMDB metadata fetch once we have the tmdbId. All
  // of these run server-side so tokens never reach the client.
  for (let i = 0; i < uncachedSlugs.length; i += 5) {
    const batch = uncachedSlugs.slice(i, i + 5);
    const settled = await Promise.allSettled(
      batch.map(async (slug): Promise<FilmDetail | null> => {
        const [pageResp, statsResult] = await Promise.all([
          fetch(`https://letterboxd.com/film/${encodeURIComponent(slug)}/`, {
            headers: HEADERS,
          }),
          fetchFilmStats(slug),
        ]);
        if (!pageResp.ok) return null;
        const html = await pageResp.text();
        if (html.includes("Just a moment")) return null;
        const detail = parseFilmPage(html, slug);

        // Merge stats fragment results (either field may be missing).
        if (statsResult) {
          if (statsResult.watchedCount != null) {
            detail.watchedCount = statsResult.watchedCount;
          }
          if (statsResult.likesCount != null) {
            detail.likesCount = statsResult.likesCount;
          }
        }

        // Enrich with TMDB metadata if Letterboxd gave us an id.
        if (detail.tmdbId && detail.tmdbType) {
          const meta = await fetchTMDBMeta(detail.tmdbId, detail.tmdbType);
          if (meta) {
            detail.posterPath = meta.posterPath;
            detail.backdropPath = meta.backdropPath;
            detail.overview = meta.overview;
            detail.tagline = meta.tagline;
          }
        }
        return detail;
      })
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) {
        setCache(`film:v2:${r.value.slug}`, r.value, "film-details");
        results.push(r.value);
      }
    }
  }

  return Response.json({ films: results });
}
