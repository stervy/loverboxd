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

  // TMDB id — Letterboxd embeds an outbound link to themoviedb.org in the
  // footer of every film page. We match either /movie/ID or /tv/ID.
  let tmdbId: number | undefined;
  let tmdbType: "movie" | "tv" | undefined;
  const tmdbMatch = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  if (tmdbMatch) {
    tmdbType = tmdbMatch[1] as "movie" | "tv";
    tmdbId = parseInt(tmdbMatch[2], 10);
  }

  return { slug, directors, genres, actors, runtime, countries, tmdbId, tmdbType };
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

  // Check cache for each slug, only fetch uncached ones
  const results: FilmDetail[] = [];
  const uncachedSlugs: string[] = [];

  for (const slug of slugs) {
    const cached = getCached<FilmDetail>(`film:${slug}`);
    if (cached) {
      results.push(cached);
    } else {
      uncachedSlugs.push(slug);
    }
  }

  // Fetch uncached film pages in parallel (max 5 concurrent). After parsing
  // each page we ALSO call TMDB for poster/backdrop/overview in parallel —
  // both fetches run server-side so the token never reaches the client.
  for (let i = 0; i < uncachedSlugs.length; i += 5) {
    const batch = uncachedSlugs.slice(i, i + 5);
    const settled = await Promise.allSettled(
      batch.map(async (slug): Promise<FilmDetail | null> => {
        const resp = await fetch(
          `https://letterboxd.com/film/${encodeURIComponent(slug)}/`,
          { headers: HEADERS }
        );
        if (!resp.ok) return null;
        const html = await resp.text();
        if (html.includes("Just a moment")) return null;
        const detail = parseFilmPage(html, slug);

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
        setCache(`film:${r.value.slug}`, r.value, "film-details");
        results.push(r.value);
      }
    }
  }

  return Response.json({ films: results });
}
