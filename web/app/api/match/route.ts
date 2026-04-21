import { NextRequest } from "next/server";
import { getCached, setCache } from "../cache";
import { fetchLetterboxd } from "../_lib/fetch-letterboxd";

// Match scrapes both the user's and the friend's full film lists plus taste
// signals — worst case is double the stats route's load. Same 60s cap.
export const maxDuration = 60;

// Kept for the RSS fallback fetch below, which stays direct because
// Letterboxd's RSS feed isn't CF-gated.
const DIRECT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://letterboxd.com/",
};

const REQUEST_DELAY = 1000; // ms between requests to avoid Cloudflare rate limiting
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RatedFilm {
  title: string;
  year: number | null;
  rating: number;
  slug: string;
}

// A film entry that may or may not carry a rating — used for the taste-mode
// comparison so users who never rate films still produce a full profile.
interface WatchedFilm {
  title: string;
  year: number | null;
  rating: number | null;
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

/**
 * Parse a watched/likes/watchlist grid page — same markup as ratings but we
 * don't require a `rated-N` span to be present.
 */
function parseFilmGridFromHTML(html: string): WatchedFilm[] {
  const films: WatchedFilm[] = [];
  const gridItems = html.split(/class="griditem/);
  for (const item of gridItems.slice(1)) {
    const nameMatch = item.match(/data-item-full-display-name="([^"]*)"/);
    const linkMatch = item.match(/data-item-link="([^"]*)"/);
    const ratingMatch = item.match(/rated-(\d+)/);

    if (!nameMatch) continue;

    const fullName = nameMatch[1];
    const yearMatch = fullName.match(/\((\d{4})\)$/);
    const title = yearMatch
      ? fullName.replace(/\s*\(\d{4}\)$/, "")
      : fullName;
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const slug = linkMatch
      ? linkMatch[1].replace(/^\/film\//, "").replace(/\/$/, "")
      : "";
    const rating = ratingMatch ? parseInt(ratingMatch[1], 10) / 2 : null;

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

/**
 * Warm up a session and return captured cookies. Hitting the profile page
 * first establishes Cloudflare cookies so subsequent requests succeed.
 */
async function warmupSession(username: string): Promise<string[]> {
  const cookies: string[] = [];
  try {
    // `fetchLetterboxd` mutates the cookies array with any Set-Cookie values
    // from the response, so we don't need to capture them manually here.
    await fetchLetterboxd(`/${username}/`, cookies);
  } catch {
    // Continue without warmup
  }
  return cookies;
}

/**
 * Paginate a user-scoped Letterboxd grid (watched/likes/watchlist) and return
 * all slugs. Bails out on Cloudflare blocks or empty pages. Capped at 50 pages
 * (~3600 films) to keep response times sane.
 */
async function fetchGridSlugs(
  username: string,
  pathSegment: "films" | "likes/films" | "watchlist",
  cookies: string[]
): Promise<string[]> {
  const slugs: string[] = [];
  try {
    for (let page = 1; page <= 50; page++) {
      if (page > 1) await sleep(REQUEST_DELAY);
      const html = await fetchLetterboxd(
        `/${username}/${pathSegment}/page/${page}/`,
        cookies,
      );
      if (html.includes("Just a moment")) break;

      const films = parseFilmGridFromHTML(html);
      if (films.length === 0) break;
      for (const f of films) if (f.slug) slugs.push(f.slug);
      if (films.length < 72) break;
    }
  } catch {
    // Return whatever we got
  }
  return slugs;
}

/**
 * Fetch likes and watchlist for a user in parallel. Cached separately so we
 * don't re-scrape on every match. Returns empty sets on failure — the taste
 * scorer degrades gracefully.
 */
async function fetchTasteSignals(
  username: string
): Promise<{ liked: Set<string>; watchlist: Set<string> }> {
  const cacheKey = `taste:${username.toLowerCase()}`;
  const cached = getCached<{ liked: string[]; watchlist: string[] }>(cacheKey);
  if (cached) {
    return {
      liked: new Set(cached.liked),
      watchlist: new Set(cached.watchlist),
    };
  }

  const cookies = await warmupSession(username);
  const [likedSlugs, watchlistSlugs] = await Promise.all([
    fetchGridSlugs(username, "likes/films", cookies),
    fetchGridSlugs(username, "watchlist", cookies),
  ]);

  const result = { liked: likedSlugs, watchlist: watchlistSlugs };
  setCache(cacheKey, result, likedSlugs.length > 0 ? "scraped" : "rss");
  return {
    liked: new Set(likedSlugs),
    watchlist: new Set(watchlistSlugs),
  };
}

// Scrape all rated films for a user by paginating through their ratings pages
async function fetchAllRatedFilms(
  username: string
): Promise<{ films: RatedFilm[]; source: "scraped" | "rss" }> {
  // Check cache first
  const cacheKey = `films:${username.toLowerCase()}`;
  const cached = getCached<{ films: RatedFilm[]; source: "scraped" | "rss" }>(
    cacheKey
  );
  if (cached) return cached;

  const allFilms: RatedFilm[] = [];
  const cookies = await warmupSession(username);

  // Scrape ratings pages (72 films per page) with delay between requests
  try {
    for (let page = 1; page <= 100; page++) {
      if (page > 1) await sleep(REQUEST_DELAY);

      const html = await fetchLetterboxd(
        `/${username}/films/ratings/page/${page}/`,
        cookies,
      );

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
  if (allFilms.length > 0) {
    const result = { films: allFilms, source: "scraped" as const };
    setCache(cacheKey, result, "scraped");
    return result;
  }

  // Fallback: use RSS feed (~50 most recent entries)
  try {
    const rssResp = await fetch(`https://letterboxd.com/${username}/rss/`, {
      headers: DIRECT_HEADERS,
    });
    const rssXml = await rssResp.text();
    const result = { films: parseRSSForRatings(rssXml), source: "rss" as const };
    setCache(cacheKey, result, "rss");
    return result;
  } catch {
    return { films: [], source: "rss" };
  }
}

/**
 * Scrape every film a user has logged (rated or not). Used by the taste-mode
 * comparison so users without ratings still produce a watched-set.
 */
async function fetchAllWatchedSlugs(username: string): Promise<Set<string>> {
  const cacheKey = `watched:${username.toLowerCase()}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return new Set(cached);

  const cookies = await warmupSession(username);
  const slugs = await fetchGridSlugs(username, "films", cookies);
  setCache(cacheKey, slugs, slugs.length > 0 ? "scraped" : "rss");
  return new Set(slugs);
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

/** Shared comparison logic used by both GET and POST. */
function compareUsers(
  friend: string,
  userMap: Map<string, { rating: number; slug: string }>,
  friendMap: Map<string, { rating: number; slug: string }>,
  dataLimited: boolean
) {
  const sharedKeys = [...userMap.keys()].filter((k) => friendMap.has(k));
  const overlap = sharedKeys.length;

  if (overlap === 0) {
    return {
      mode: "ratings" as const,
      username: friend,
      overlapCount: 0,
      avgDifference: 0,
      cosineSimilarity: 0,
      score: 0,
      sharedFilms: [],
      userTotal: userMap.size,
      friendTotal: friendMap.size,
      dataLimited,
    };
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

  return {
    mode: "ratings" as const,
    username: friend,
    overlapCount: overlap,
    avgDifference: avgDiff,
    cosineSimilarity: cosSim,
    score,
    sharedFilms,
    sharedSlugs,
    userTotal: userMap.size,
    friendTotal: friendMap.size,
    dataLimited,
  };
}

/**
 * Taste-mode comparison — used when either user has no star ratings. Builds
 * a compatibility score from watched-set overlap, liked-film overlap, and
 * watchlist-bridge (films one user already loves that are on the other's
 * "to watch" list). Each component maps to a 0-1 normalized value and is
 * combined with fixed weights summing to 1.
 */
interface TasteCompareInput {
  watched: Set<string>;
  liked: Set<string>;
  watchlist: Set<string>;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function compareUsersByTaste(
  friend: string,
  user: TasteCompareInput,
  partner: TasteCompareInput,
  dataLimited: boolean
) {
  // 1. Watched overlap (30%) — Jaccard over the full watched sets.
  const watchedJaccard = jaccard(user.watched, partner.watched);

  // 2. Liked overlap (40%) — of the smaller liked set, how many match the other's.
  // Normalized against the smaller liked set so one tiny-liked user doesn't tank it.
  let likedOverlapCount = 0;
  for (const s of user.liked) if (partner.liked.has(s)) likedOverlapCount++;
  const smallerLiked = Math.min(user.liked.size, partner.liked.size);
  const likedOverlap = smallerLiked > 0 ? likedOverlapCount / smallerLiked : 0;

  // 3. Watchlist bridge (15%) — films on one user's watchlist the other has already liked.
  // Bidirectional: count either direction, normalize against total watchlist size.
  let bridgeCount = 0;
  for (const s of user.watchlist) if (partner.liked.has(s)) bridgeCount++;
  for (const s of partner.watchlist) if (user.liked.has(s)) bridgeCount++;
  const totalWatchlist = user.watchlist.size + partner.watchlist.size;
  const watchlistBridge =
    totalWatchlist > 0 ? Math.min(bridgeCount / Math.max(totalWatchlist / 4, 1), 1) : 0;

  // 4. Shared-love bonus (15%) — films on BOTH users' liked lists. Strongest signal.
  let sharedLovedCount = 0;
  for (const s of user.liked) if (partner.liked.has(s)) sharedLovedCount++;
  const sharedLoved = Math.min(sharedLovedCount / 10, 1); // 10 shared loves = max

  const score =
    Math.round(
      (0.3 * watchedJaccard +
        0.4 * likedOverlap +
        0.15 * watchlistBridge +
        0.15 * sharedLoved) *
        1000
    ) / 10;

  // Collect shared slugs for enrichment & "both loved" / "both watched" tabs.
  const bothLoved: string[] = [];
  for (const s of user.liked) if (partner.liked.has(s)) bothLoved.push(s);
  const bothWatched: string[] = [];
  for (const s of user.watched) if (partner.watched.has(s)) bothWatched.push(s);
  // "They loved, you haven't seen" — recommendations.
  const theyLovedYouHavent: string[] = [];
  for (const s of partner.liked) if (!user.watched.has(s)) theyLovedYouHavent.push(s);

  const sharedSlugs = [...new Set([...bothLoved, ...bothWatched.slice(0, 30)])];

  return {
    mode: "taste" as const,
    username: friend,
    score,
    overlapCount: bothWatched.length,
    breakdown: {
      watchedJaccard: Math.round(watchedJaccard * 1000) / 1000,
      likedOverlap: Math.round(likedOverlap * 1000) / 1000,
      watchlistBridge: Math.round(watchlistBridge * 1000) / 1000,
      sharedLoved: Math.round(sharedLoved * 1000) / 1000,
    },
    bothLoved: bothLoved.slice(0, 30),
    bothWatched: bothWatched.slice(0, 30),
    theyLovedYouHavent: theyLovedYouHavent.slice(0, 10),
    sharedSlugs,
    userTotal: user.watched.size,
    friendTotal: partner.watched.size,
    userLikes: user.liked.size,
    friendLikes: partner.liked.size,
    dataLimited,
  };
}

/** GET — both users' data fetched server-side (original flow). */
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
    const [userData, friendData] = await Promise.all([
      fetchAllRatedFilms(username),
      fetchAllRatedFilms(friend),
    ]);

    const userMap = buildRatingMap(userData.films);
    const friendMap = buildRatingMap(friendData.films);
    const dataLimited =
      userData.source === "rss" || friendData.source === "rss";

    // Try rating-mode first. Fall back to taste mode if either side has no
    // ratings, or if the rated sets don't overlap — in which case watched/
    // liked/watchlist signals still produce a meaningful comparison.
    const ratingResult =
      userMap.size > 0 && friendMap.size > 0
        ? compareUsers(friend, userMap, friendMap, dataLimited)
        : null;

    if (!ratingResult || ratingResult.overlapCount === 0) {
      const [userTaste, friendTaste] = await Promise.all([
        (async () => ({
          watched: await fetchAllWatchedSlugs(username),
          ...(await fetchTasteSignals(username)),
        }))(),
        (async () => ({
          watched: await fetchAllWatchedSlugs(friend),
          ...(await fetchTasteSignals(friend)),
        }))(),
      ]);
      return Response.json(
        compareUsersByTaste(friend, userTaste, friendTaste, dataLimited)
      );
    }

    return Response.json(ratingResult);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/** POST — user's films supplied from CSV export, friend fetched server-side. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      username,
      friend,
      userFilms,
      userLikedSlugs,
      userWatchlistSlugs,
    } = body as {
      username?: string;
      friend?: string;
      userFilms?: {
        title: string;
        year: number | null;
        rating: number | null;
        slug: string;
      }[];
      userLikedSlugs?: string[];
      userWatchlistSlugs?: string[];
    };

    if (!username || !friend || !Array.isArray(userFilms)) {
      return Response.json(
        { error: "Provide username, friend, and userFilms" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(friend)) {
      return Response.json({ error: "Invalid friend username" }, { status: 400 });
    }

    // Build rating map from the rated subset of the user's CSV films.
    const ratedCSVFilms: RatedFilm[] = userFilms
      .filter((f) => f.title && f.rating != null)
      .map((f) => ({
        title: String(f.title),
        year: f.year ?? null,
        rating: Number(f.rating),
        slug: String(f.slug ?? ""),
      }));

    const userMap = buildRatingMap(ratedCSVFilms);

    const friendData = await fetchAllRatedFilms(friend);
    const friendMap = buildRatingMap(friendData.films);
    const dataLimited = friendData.source === "rss";

    // Try rating-mode first. Fall back to taste mode if either user lacks
    // ratings, or if the rated sets don't overlap — watched/liked/watchlist
    // signals still produce a meaningful comparison.
    const ratingResult =
      userMap.size > 0 && friendMap.size > 0
        ? compareUsers(friend, userMap, friendMap, dataLimited)
        : null;

    if (!ratingResult || ratingResult.overlapCount === 0) {
      const userWatched = new Set(
        userFilms.map((f) => f.slug).filter(Boolean)
      );
      const userLiked = new Set(userLikedSlugs ?? []);
      const userWatchlist = new Set(userWatchlistSlugs ?? []);

      const friendTaste = {
        watched: await fetchAllWatchedSlugs(friend),
        ...(await fetchTasteSignals(friend)),
      };

      return Response.json(
        compareUsersByTaste(
          friend,
          { watched: userWatched, liked: userLiked, watchlist: userWatchlist },
          friendTaste,
          dataLimited
        )
      );
    }

    return Response.json(ratingResult);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
