import { NextRequest } from "next/server";
import { getCached, setCache } from "../cache";
import { fetchLetterboxd } from "../_lib/fetch-letterboxd";
import demoData from "./demo-data.json";

// Raise Vercel's default 10s function timeout. A single stats call does up to
// four paginated scrapes (ratings + likes + watchlist + watched); power users
// with thousands of films can legitimately take ~30–40s on a cold cache.
// 60s is the Pro-tier default cap.
export const maxDuration = 60;

// Kept for the RSS fetch below, which intentionally stays on a direct route
// since feeds.letterboxd.com isn't CF-gated.
const DIRECT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://letterboxd.com/",
};

// Pagination is now parallelized in chunks (see PARALLEL_CHUNK below), so the
// old per-request sleep for CF politeness isn't needed — when routed through
// the ScraperAPI-backed Worker, that service handles rate limiting; when
// hitting letterboxd.com directly, the chunk size itself caps concurrency.

/**
 * Fetch a letterboxd.com path through the shared helper, which routes via the
 * CF Worker proxy when configured. Local wrapper keeps the old (url, cookies)
 * signature the scrape loops were already using — converts absolute URL → path.
 */
async function fetchPage(url: string, cookies: string[]): Promise<string> {
  const path = url.startsWith("https://letterboxd.com")
    ? url.slice("https://letterboxd.com".length)
    : url;
  return fetchLetterboxd(path, cookies);
}

function parseProfile(html: string, username: string) {
  // displayname has nested spans: <span class="displayname ..."><span class="label">Name</span></span>
  const displayName =
    html.match(/class="displayname[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/)?.[1]?.trim() ??
    html.match(/title="([^"]+)"[^>]*class="displayname/)?.[1]?.trim() ??
    username;
  const bio =
    html.match(/class="body-text -bio"[^>]*>([\s\S]*?)<\/div/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";

  const statsMatches = [
    ...html.matchAll(
      /<a[^>]*href="[^"]*\/(films|following|followers|lists)\/?"[^>]*>[\s\S]*?class="value"[^>]*>([\d,]+)/g
    ),
  ];
  const stats: Record<string, number> = {};
  for (const m of statsMatches) {
    // Only keep the first match per key (avoids "this year" overwriting total)
    if (!(m[1] in stats)) {
      stats[m[1]] = parseInt(m[2].replace(/,/g, ""), 10);
    }
  }

  // Favorites
  const favSection = html.match(
    /id="favourites"[\s\S]*?<\/section/
  )?.[0];
  const favorites: string[] = [];
  if (favSection) {
    const altMatches = favSection.matchAll(/alt="([^"]+)"/g);
    for (const m of altMatches) favorites.push(m[1]);
  }

  return {
    displayName,
    bio: bio.slice(0, 200),
    filmsWatched: stats["films"] ?? 0,
    following: stats["following"] ?? 0,
    followers: stats["followers"] ?? 0,
    listsCount: stats["lists"] ?? 0,
    favorites,
  };
}

/**
 * Parse any user-scoped grid page (ratings, likes, watchlist) for slugs. Grids
 * on Letterboxd share the same `.griditem` + `data-item-link` markup; the
 * `rated-N` class only appears on the ratings page, so we treat it as optional.
 */
function parseGridSlugs(html: string): string[] {
  const slugs: string[] = [];
  const gridItems = html.split(/class="griditem/);
  for (const item of gridItems.slice(1)) {
    const linkMatch = item.match(/data-item-link="([^"]*)"/);
    if (!linkMatch) continue;
    const slug = linkMatch[1].replace(/^\/film\//, "").replace(/\/$/, "");
    if (slug) slugs.push(slug);
  }
  return slugs;
}

/**
 * Paginate a user-scoped grid (likes/films or watchlist) and return every
 * slug. Mirrors the approach in /api/match/route.ts so behavior stays
 * consistent — same 50-page cap, same CF-block bailout.
 */
/**
 * How many pages to fetch concurrently. ScraperAPI's free plan allows ~10
 * concurrent requests; 5 is safely under and still gives us ~5× wall-clock
 * speedup versus sequential. Adjust up if we move to a bigger plan.
 */
const PARALLEL_CHUNK = 5;

async function fetchGridSlugs(
  username: string,
  pathSegment: "likes/films" | "watchlist" | "films",
  cookies: string[]
): Promise<string[]> {
  const all: string[] = [];
  const maxPages = 50; // ~3600 films — enough for all but extreme power users
  try {
    for (let startPage = 1; startPage <= maxPages; startPage += PARALLEL_CHUNK) {
      const pageNums = Array.from(
        { length: Math.min(PARALLEL_CHUNK, maxPages - startPage + 1) },
        (_, i) => startPage + i,
      );
      const htmls = await Promise.all(
        pageNums.map((p) =>
          fetchPage(
            `https://letterboxd.com/${username}/${pathSegment}/page/${p}/`,
            cookies,
          ),
        ),
      );

      // Walk the chunk results in order; a page with fewer than a full 72
      // items (or zero / CF block) means we've reached the tail — accept the
      // slugs we got up to that point and stop.
      let hitEnd = false;
      for (const html of htmls) {
        if (html.includes("Just a moment")) {
          hitEnd = true;
          break;
        }
        const slugs = parseGridSlugs(html);
        if (slugs.length === 0) {
          hitEnd = true;
          break;
        }
        all.push(...slugs);
        if (slugs.length < 72) {
          hitEnd = true;
          break;
        }
      }
      if (hitEnd) break;
    }
  } catch {
    // Return whatever we managed to scrape
  }
  return all;
}

function parseRatedFilms(html: string) {
  const films: {
    title: string;
    slug: string;
    year: number | null;
    rating: number | null;
    filmId: string;
  }[] = [];

  // Parse li.griditem elements with react-component data attributes
  const itemRegex =
    /data-item-full-display-name="([^"]*)"[^>]*data-film-id="(\d+)"[^>]*data-item-link="([^"]*)"/g;
  const ratingRegex = /rated-(\d+)/;

  // Split by griditem to pair films with ratings
  const gridItems = html.split(/class="griditem/);
  for (const item of gridItems.slice(1)) {
    const nameMatch = item.match(
      /data-item-full-display-name="([^"]*)"/
    );
    const idMatch = item.match(/data-film-id="(\d+)"/);
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
    const rating = ratingMatch
      ? parseInt(ratingMatch[1], 10) / 2
      : null;

    films.push({
      title,
      slug,
      year,
      rating,
      filmId: idMatch?.[1] ?? "",
    });
  }

  return films;
}

function parseRSS(xml: string) {
  const entries: {
    title: string;
    filmTitle: string;
    filmYear: number | null;
    rating: number | null;
    watchDate: string;
    isRewatch: boolean;
    link: string;
    posterUrl: string;
  }[] = [];

  const items = xml.split("<item>");
  for (const item of items.slice(1)) {
    const get = (tag: string) =>
      item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ??
      "";
    const getCDATA = (tag: string) =>
      item
        .match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`))?.[1]?.trim() ??
      get(tag);

    const title = getCDATA("title");
    const filmTitle =
      get("letterboxd:filmTitle") || title;
    const filmYearStr = get("letterboxd:filmYear");
    const filmYear = filmYearStr ? parseInt(filmYearStr, 10) : null;
    const ratingStr = get("letterboxd:memberRating");
    const rating = ratingStr ? parseFloat(ratingStr) : null;
    const watchDate = get("letterboxd:watchedDate");
    const isRewatch = get("letterboxd:rewatch") === "Yes";
    const link = get("link");

    // Poster from description
    const desc = getCDATA("description");
    const posterMatch = desc.match(/src="([^"]+)"/);
    const posterUrl = posterMatch?.[1] ?? "";

    entries.push({
      title,
      filmTitle,
      filmYear,
      rating,
      watchDate,
      isRewatch,
      link,
      posterUrl,
    });
  }

  return entries;
}

interface StatsResponse {
  profile: ReturnType<typeof parseProfile>;
  stats: {
    totalRated: number;
    totalFilms: number;
    avgRating: number;
    ratingDistribution: Record<number, number>;
    decadeDistribution: Record<string, number>;
    topRated: ReturnType<typeof parseRatedFilms>;
    recentActivity: ReturnType<typeof parseRSS>;
    rewatchCount: number;
    allSlugs: string[];
    // Liked + watchlist slugs scraped from /likes/films/ and /watchlist/.
    // Empty when those pages are private or Cloudflare blocked the scrape;
    // the UI falls back to CSV-derived equivalents in that case.
    likedSlugs: string[];
    watchlistSlugs: string[];
    source: "scraped" | "rss";
  };
}

/**
 * Assemble a StatsResponse from just profile data + RSS entries. Used by the
 * `?minimal=1` fast path so the dashboard has something to render within ~2s
 * while the full scrape runs. All scrape-backed fields (likedSlugs,
 * watchlistSlugs) come back empty and `source` is "rss" so the client knows
 * to trust its upgrade call when it lands.
 */
function buildMinimalResponse(
  profile: ReturnType<typeof parseProfile>,
  rssEntries: ReturnType<typeof parseRSS>,
): StatsResponse {
  const rssFilms = rssEntries
    .filter((e) => e.rating !== null)
    .map((e) => {
      const slugMatch = e.link.match(/\/film\/([^/]+)/);
      return {
        title: e.filmTitle,
        slug: slugMatch?.[1] ?? "",
        year: e.filmYear,
        rating: e.rating,
        filmId: "",
      };
    });

  const rated = rssFilms.filter((f) => f.rating !== null);
  const avgRating =
    rated.length > 0
      ? Math.round(
          (rated.reduce((sum, f) => sum + f.rating!, 0) / rated.length) * 100
        ) / 100
      : 0;

  const ratingDist: Record<number, number> = {};
  for (const f of rated) {
    ratingDist[f.rating!] = (ratingDist[f.rating!] ?? 0) + 1;
  }

  const decadeDist: Record<string, number> = {};
  for (const f of rssFilms) {
    if (f.year) {
      const decade = `${Math.floor(f.year / 10) * 10}s`;
      decadeDist[decade] = (decadeDist[decade] ?? 0) + 1;
    }
  }

  const topRated = [...rated]
    .sort((a, b) => b.rating! - a.rating!)
    .slice(0, 10);

  return {
    profile,
    stats: {
      totalRated: rated.length,
      // `filmsWatched` from the profile header is authoritative for the header
      // stat — use it when present so the minimal view doesn't display "20"
      // while the full scrape is in flight.
      totalFilms: profile.filmsWatched || rssFilms.length,
      avgRating,
      ratingDistribution: ratingDist,
      decadeDistribution: decadeDist,
      topRated,
      recentActivity: rssEntries.slice(0, 20),
      rewatchCount: rssEntries.filter((e) => e.isRewatch).length,
      allSlugs: [...new Set(rssFilms.map((f) => f.slug).filter(Boolean))],
      likedSlugs: [],
      watchlistSlugs: [],
      source: "rss",
    },
  };
}

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username");
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return Response.json({ error: "Invalid username" }, { status: 400 });
  }

  // `?demo=1` returns a checked-in snapshot of a real response. Useful for
  // iterating on the UI without burning ScraperAPI credits — no scraping,
  // no cache reads/writes, no timeouts. The fixture is a real stervy profile
  // scrape with 772 films so every panel has enough data to render.
  if (request.nextUrl.searchParams.get("demo") === "1") {
    return Response.json(demoData);
  }

  // When the client sets ?minimal=1 it's doing a two-tier fetch: render fast
  // RSS-based data first, then upgrade once the full scrape arrives. We skip
  // the expensive scrapes entirely in this mode so the response is ~1–2s.
  //
  // If the full composite cache happens to be warm we return that (superset)
  // instead — no reason to give the user less data than we already have.
  const minimal = request.nextUrl.searchParams.get("minimal") === "1";

  // Check cache first
  const cacheKey = `stats:${username.toLowerCase()}`;
  const cached = getCached<StatsResponse>(cacheKey);
  if (cached) {
    return Response.json(cached);
  }

  try {
    const cookies: string[] = [];

    // 1. Warm up session with profile page
    const profileHtml = await fetchPage(
      `https://letterboxd.com/${username}/`,
      cookies
    );

    if (profileHtml.includes("Just a moment")) {
      return Response.json(
        { error: "Cloudflare blocked the request. Try again." },
        { status: 503 }
      );
    }

    const profile = parseProfile(profileHtml, username);

    // 2. Fetch RSS feed (always works, no Cloudflare)
    const rssResp = await fetch(
      `https://letterboxd.com/${username}/rss/`,
      { headers: DIRECT_HEADERS }
    );
    const rssXml = await rssResp.text();
    const rssEntries = parseRSS(rssXml);

    // Minimal fast-path: return profile + RSS-derived stats immediately and
    // skip the expensive paginated scrapes. The client will follow up with a
    // second (non-minimal) request to upgrade the data in place.
    if (minimal) {
      return Response.json(
        buildMinimalResponse(profile, rssEntries),
      );
    }

    // 3. Scrape ALL rated films pages (may fail due to Cloudflare).
    //
    // Cached under `ratings:<user>` independently of the top-level `stats:`
    // cache so that when the composite payload expires (1h TTL) but the
    // sub-scrapes are still fresh, we skip the ratings loop entirely. Biggest
    // win on returning users: no re-paginating through 20+ pages of ratings.
    const ratingsCacheKey = `ratings:${username.toLowerCase()}`;
    const cachedRatings =
      getCached<ReturnType<typeof parseRatedFilms>>(ratingsCacheKey);
    let scrapedFilms: ReturnType<typeof parseRatedFilms>;
    if (cachedRatings) {
      scrapedFilms = cachedRatings;
    } else {
      scrapedFilms = [];
      const maxPages = 50;
      try {
        outer: for (
          let startPage = 1;
          startPage <= maxPages;
          startPage += PARALLEL_CHUNK
        ) {
          const pageNums = Array.from(
            { length: Math.min(PARALLEL_CHUNK, maxPages - startPage + 1) },
            (_, i) => startPage + i,
          );
          const htmls = await Promise.all(
            pageNums.map((p) =>
              fetchPage(
                `https://letterboxd.com/${username}/films/ratings/page/${p}/`,
                cookies,
              ),
            ),
          );
          for (const html of htmls) {
            if (html.includes("Just a moment")) break outer;
            const films = parseRatedFilms(html);
            if (films.length === 0) break outer;
            scrapedFilms.push(...films);
            if (films.length < 72) break outer;
          }
        }
      } catch {
        // Cloudflare blocked — fall through to RSS-based stats
      }
      // Only cache non-empty results as "scraped"; empty likely means CF
      // blocked us, and we'd rather retry in 5 minutes than poison for an hour.
      if (scrapedFilms.length > 0) {
        setCache(ratingsCacheKey, scrapedFilms, "scraped");
      }
    }

    // 3b. Scrape likes, watchlist, and the full watched list in parallel.
    //
    // Two separate cache keys:
    //   - `taste:<user>` stays compatible with /api/match, which already reads
    //     this shape — keeps a single stats call + a single match call to just
    //     one scrape total.
    //   - `watched:<user>` is new and owned by this route. It covers the full
    //     /films/ grid (rated + unrated), letting non-raters get an accurate
    //     "films watched" total without a CSV upload.
    //
    // Empty arrays degrade gracefully: the UI falls back to CSV data, or just
    // shows whatever the ratings scrape produced.
    const tasteCacheKey = `taste:${username.toLowerCase()}`;
    const watchedCacheKey = `watched:${username.toLowerCase()}`;
    const cachedTaste = getCached<{ liked: string[]; watchlist: string[] }>(
      tasteCacheKey
    );
    const cachedWatched = getCached<string[]>(watchedCacheKey);

    const [taste, watchedSlugs] = await Promise.all([
      cachedTaste
        ? Promise.resolve(cachedTaste)
        : Promise.all([
            fetchGridSlugs(username, "likes/films", cookies),
            fetchGridSlugs(username, "watchlist", cookies),
          ]).then(([liked, watchlist]) => {
            const result = { liked, watchlist };
            setCache(
              tasteCacheKey,
              result,
              liked.length > 0 || watchlist.length > 0 ? "scraped" : "rss"
            );
            return result;
          }),
      cachedWatched !== null
        ? Promise.resolve(cachedWatched)
        : fetchGridSlugs(username, "films", cookies).then((slugs) => {
            setCache(
              watchedCacheKey,
              slugs,
              slugs.length > 0 ? "scraped" : "rss"
            );
            return slugs;
          }),
    ]);
    const likedSlugs = taste.liked;
    const watchlistSlugs = taste.watchlist;

    // 4. Compute stats — use scraped films if available, otherwise RSS
    const useScraped = scrapedFilms.length > 0;

    // Build unified film list from RSS (always available)
    const rssFilms = rssEntries
      .filter((e) => e.rating !== null)
      .map((e) => {
        // Extract slug from link like "https://letterboxd.com/user/film/slug/"
        const slugMatch = e.link.match(/\/film\/([^/]+)/);
        return {
          title: e.filmTitle,
          slug: slugMatch?.[1] ?? "",
          year: e.filmYear,
          rating: e.rating,
          filmId: "",
        };
      });

    const allFilms = useScraped ? scrapedFilms : rssFilms;
    const rated = allFilms.filter((f) => f.rating !== null);

    const avgRating =
      rated.length > 0
        ? Math.round(
            (rated.reduce((sum, f) => sum + f.rating!, 0) / rated.length) *
              100
          ) / 100
        : 0;

    const ratingDist: Record<number, number> = {};
    for (const f of rated) {
      ratingDist[f.rating!] = (ratingDist[f.rating!] ?? 0) + 1;
    }

    const decadeDist: Record<string, number> = {};
    for (const f of allFilms) {
      if (f.year) {
        const decade = `${Math.floor(f.year / 10) * 10}s`;
        decadeDist[decade] = (decadeDist[decade] ?? 0) + 1;
      }
    }

    const recentActivity = rssEntries.slice(0, 20);

    const topRated = [...rated]
      .sort((a, b) => b.rating! - a.rating!)
      .slice(0, 10);

    const rewatchCount = rssEntries.filter((e) => e.isRewatch).length;

    // Collect all unique slugs for enrichment. Liked and watched (full /films/
    // grid) slugs are folded in so TMDB enrichment covers films the user never
    // rated — necessary for the Liked Films Club panel and for matching
    // `totalFilms` to the user's actual watched count.
    const allSlugs = [
      ...new Set(
        [
          ...allFilms.map((f) => f.slug),
          ...likedSlugs,
          ...watchedSlugs,
        ].filter(Boolean),
      ),
    ];
    // `totalFilms` used to equal rated-count because that's all we scraped.
    // Now it reflects the union of (rated ∪ scraped-watched), which matches
    // what Letterboxd shows on the profile header. When the watched scrape
    // comes back empty (CF blocked or private profile), fall back to the old
    // behavior so we don't undercount.
    const watchedUnionSize =
      watchedSlugs.length > 0
        ? new Set([...allFilms.map((f) => f.slug), ...watchedSlugs].filter(Boolean))
            .size
        : allFilms.length;

    const source = useScraped ? "scraped" : "rss";
    const result: StatsResponse = {
      profile,
      stats: {
        totalRated: rated.length,
        totalFilms: watchedUnionSize,
        avgRating,
        ratingDistribution: ratingDist,
        decadeDistribution: decadeDist,
        topRated,
        recentActivity,
        rewatchCount,
        allSlugs,
        likedSlugs,
        watchlistSlugs,
        source,
      },
    };

    setCache(cacheKey, result, source);
    return Response.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
