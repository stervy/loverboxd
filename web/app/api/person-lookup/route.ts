import { NextRequest } from "next/server";
import { getCached, setCache } from "../cache";

/**
 * Lookup TMDB person data (tmdb id + profile photo path) by name.
 *
 * We don't have TMDB person IDs embedded in Letterboxd film HTML the way we
 * do movie IDs — only names. So this endpoint hits TMDB's /search/person
 * and takes the first result, which TMDB ranks by popularity. That's
 * right for ~95% of names; ambiguous common names ("Chris Evans") resolve
 * to the most-popular homonym which is usually the one the user means in
 * a film context.
 *
 * Optional `role` param ("director" | "actor") upgrades disambiguation by
 * preferring results whose `known_for_department` matches. Cache key
 * includes role so the Directing-Chris-Evans and Acting-Chris-Evans don't
 * collide if anyone ever asks for both.
 *
 * All lookups are cached 24h under the existing `film-details` tier —
 * person photos don't change and this keeps cache config simple.
 */

interface PersonHit {
  name: string;
  tmdbId: number;
  profilePath?: string;
  department?: string;
}

interface TMDBPerson {
  id: number;
  name: string;
  profile_path?: string | null;
  known_for_department?: string;
  popularity?: number;
}

async function lookupOne(
  name: string,
  role: "director" | "actor" | undefined
): Promise<PersonHit | null> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return null;

  const normalized = name.trim();
  if (!normalized) return null;

  const cacheKey = `person:${role ?? "any"}:${normalized.toLowerCase()}`;
  const cached = getCached<PersonHit>(cacheKey);
  if (cached) return cached;
  // Note: we only cache hits. Misses re-hit TMDB every time but misses
  // should be very rare (real director/actor names in scraped Letterboxd
  // HTML are effectively always in TMDB).

  try {
    const url = new URL("https://api.themoviedb.org/3/search/person");
    url.searchParams.set("query", normalized);
    url.searchParams.set("include_adult", "false");
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { results?: TMDBPerson[] };
    const results = json.results ?? [];
    if (results.length === 0) return null;

    // Prefer a result whose known_for_department matches the requested role.
    // Fall back to the top (most-popular) result if none match.
    const wantDept =
      role === "director" ? "Directing" : role === "actor" ? "Acting" : null;
    const pick =
      (wantDept && results.find((r) => r.known_for_department === wantDept)) ||
      results[0];

    const hit: PersonHit = {
      name: pick.name,
      tmdbId: pick.id,
      profilePath: pick.profile_path ?? undefined,
      department: pick.known_for_department,
    };
    setCache(cacheKey, hit, "film-details");
    return hit;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { names?: string[]; role?: "director" | "actor" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const names = body.names;
  if (!Array.isArray(names) || names.length === 0 || names.length > 30) {
    return Response.json({ error: "Provide 1-30 names" }, { status: 400 });
  }

  const role = body.role === "director" || body.role === "actor" ? body.role : undefined;

  // Run lookups in parallel — TMDB search is fast (~100ms) and cached on
  // repeat. Capped at 30 above so we never blast the rate limit (~50/s).
  const results = await Promise.all(names.map((n) => lookupOne(n, role)));

  const people: Record<string, PersonHit> = {};
  for (let i = 0; i < names.length; i++) {
    const r = results[i];
    if (r) people[names[i]] = r;
  }

  return Response.json({ people });
}
