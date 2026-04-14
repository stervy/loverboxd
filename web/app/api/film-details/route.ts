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

  return { slug, directors, genres, actors };
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

  // Fetch uncached film pages in parallel (max 5 concurrent)
  for (let i = 0; i < uncachedSlugs.length; i += 5) {
    const batch = uncachedSlugs.slice(i, i + 5);
    const settled = await Promise.allSettled(
      batch.map(async (slug) => {
        const resp = await fetch(
          `https://letterboxd.com/film/${encodeURIComponent(slug)}/`,
          { headers: HEADERS }
        );
        if (!resp.ok) return null;
        const html = await resp.text();
        if (html.includes("Just a moment")) return null;
        return parseFilmPage(html, slug);
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
