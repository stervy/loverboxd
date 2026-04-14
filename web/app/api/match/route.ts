import { NextRequest } from "next/server";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://letterboxd.com/",
};

interface RatedFilm {
  title: string;
  year: number | null;
  rating: number;
  slug: string;
}

// Parse rated films from a Letterboxd ratings page HTML
function parseRatedFilmsFromHTML(html: string): RatedFilm[] {
  const films: RatedFilm[] = [];
  const gridItems = html.split(/class="griditem/);
  for (const item of gridItems.slice(1)) {
    const nameMatch = item.match(/data-item-full-display-name="([^"]*)"/);
    const ratingMatch = item.match(/rated-(\d+)/);
    const linkMatch = item.match(/data-item-link="([^"]*)"/);

    if (!nameMatch || !ratingMatch) continue;

    const fullName = nameMatch[1];
    const yearMatch = fullName.match(/\((\d{4})\)$/);
    const title = yearMatch
      ? fullName.replace(/\s*\(\d{4}\)$/, "")
      : fullName;
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const rating = parseInt(ratingMatch[1], 10) / 2;
    const slug = linkMatch
      ? linkMatch[1].replace(/^\/film\//, "").replace(/\/$/, "")
      : "";

    films.push({ title, year, rating, slug });
  }
  return films;
}

// Parse rated films from RSS feed (fallback, ~50 films max)
function parseRSSForRatings(xml: string): RatedFilm[] {
  const films: RatedFilm[] = [];
  const items = xml.split("<item>");
  for (const item of items.slice(1)) {
    const get = (tag: string) =>
      item
        .match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]
        ?.trim() ?? "";

    const filmTitle = get("letterboxd:filmTitle");
    const filmYearStr = get("letterboxd:filmYear");
    const ratingStr = get("letterboxd:memberRating");

    if (!filmTitle || !ratingStr) continue;

    // Extract slug from link like "https://letterboxd.com/user/film/slug/"
    const link = get("link");
    const slugMatch = link.match(/\/film\/([^/]+)/);

    films.push({
      title: filmTitle,
      year: filmYearStr ? parseInt(filmYearStr, 10) : null,
      rating: parseFloat(ratingStr),
      slug: slugMatch?.[1] ?? "",
    });
  }
  return films;
}

// Scrape all rated films for a user by paginating through their ratings pages
async function fetchAllRatedFilms(username: string): Promise<RatedFilm[]> {
  const allFilms: RatedFilm[] = [];
  const cookies: string[] = [];

  // Try scraping ratings pages (72 films per page)
  try {
    for (let page = 1; page <= 100; page++) {
      const resp = await fetch(
        `https://letterboxd.com/${username}/films/ratings/page/${page}/`,
        {
          headers: {
            ...HEADERS,
            ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
          },
          redirect: "follow",
        }
      );

      // Capture cookies for session continuity
      const setCookie = resp.headers.getSetCookie?.() ?? [];
      for (const c of setCookie) {
        cookies.push(c.split(";")[0]);
      }

      const html = await resp.text();

      // Cloudflare block — fall back to RSS
      if (html.includes("Just a moment")) break;

      const films = parseRatedFilmsFromHTML(html);
      if (films.length === 0) break; // No more pages
      allFilms.push(...films);

      // If we got fewer than a full page, we've reached the end
      if (films.length < 72) break;
    }
  } catch {
    // Scraping failed — fall through to RSS fallback
  }

  // If scraping got results, use them
  if (allFilms.length > 0) return allFilms;

  // Fallback: use RSS feed (~50 most recent entries)
  try {
    const rssResp = await fetch(`https://letterboxd.com/${username}/rss/`, {
      headers: HEADERS,
    });
    const rssXml = await rssResp.text();
    return parseRSSForRatings(rssXml);
  } catch {
    return [];
  }
}

function buildRatingMap(
  films: RatedFilm[]
): Map<string, { rating: number; slug: string }> {
  const map = new Map<string, { rating: number; slug: string }>();
  for (const f of films) {
    const key = `${f.title.toLowerCase()} (${f.year ?? "?"})`;
    if (!map.has(key)) map.set(key, { rating: f.rating, slug: f.slug });
  }
  return map;
}

function cosineSimilarity(
  a: Map<string, { rating: number; slug: string }>,
  b: Map<string, { rating: number; slug: string }>
): number {
  const shared = [...a.keys()].filter((k) => b.has(k));
  if (shared.length === 0) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (const k of shared) {
    dot += a.get(k)!.rating * b.get(k)!.rating;
    magA += a.get(k)!.rating ** 2;
    magB += b.get(k)!.rating ** 2;
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  return magA && magB ? dot / (magA * magB) : 0;
}

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username");
  const friend = request.nextUrl.searchParams.get("friend");

  if (!username || !friend) {
    return Response.json(
      { error: "Provide both username and friend params" },
      { status: 400 }
    );
  }

  if (
    !/^[a-zA-Z0-9_-]+$/.test(username) ||
    !/^[a-zA-Z0-9_-]+$/.test(friend)
  ) {
    return Response.json({ error: "Invalid username" }, { status: 400 });
  }

  try {
    // Fetch all rated films for both users in parallel
    const [userFilms, friendFilms] = await Promise.all([
      fetchAllRatedFilms(username),
      fetchAllRatedFilms(friend),
    ]);

    const userMap = buildRatingMap(userFilms);
    const friendMap = buildRatingMap(friendFilms);

    const sharedKeys = [...userMap.keys()].filter((k) => friendMap.has(k));
    const overlap = sharedKeys.length;

    if (overlap === 0) {
      return Response.json({
        username: friend,
        overlapCount: 0,
        avgDifference: 0,
        cosineSimilarity: 0,
        score: 0,
        sharedFilms: [],
        userTotal: userMap.size,
        friendTotal: friendMap.size,
      });
    }

    const diffs = sharedKeys.map((k) =>
      Math.abs(userMap.get(k)!.rating - friendMap.get(k)!.rating)
    );
    const avgDiff =
      Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 100) /
      100;
    const cosSim =
      Math.round(cosineSimilarity(userMap, friendMap) * 1000) / 1000;

    const overlapNorm = Math.min(overlap / 20, 1);
    const agreementNorm = 1 - avgDiff / 5;
    const score =
      Math.round(
        (0.3 * overlapNorm + 0.3 * agreementNorm + 0.4 * cosSim) * 1000
      ) / 10;

    // Collect all shared film slugs for enrichment
    const sharedSlugs = [
      ...new Set(
        sharedKeys
          .map((k) => userMap.get(k)!.slug || friendMap.get(k)!.slug)
          .filter(Boolean)
      ),
    ];

    const sharedFilms = sharedKeys.slice(0, 15).map((k) => ({
      title: k,
      yourRating: userMap.get(k)!.rating,
      theirRating: friendMap.get(k)!.rating,
      slug: userMap.get(k)!.slug || friendMap.get(k)!.slug,
    }));

    return Response.json({
      username: friend,
      overlapCount: overlap,
      avgDifference: avgDiff,
      cosineSimilarity: cosSim,
      score,
      sharedFilms,
      sharedSlugs,
      userTotal: userMap.size,
      friendTotal: friendMap.size,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
