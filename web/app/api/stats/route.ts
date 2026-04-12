import { NextRequest } from "next/server";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://letterboxd.com/",
};

async function fetchPage(url: string, cookies: string[]): Promise<string> {
  const cookieHeader = cookies.join("; ");
  const resp = await fetch(url, {
    headers: { ...HEADERS, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    redirect: "follow",
  });
  // Capture set-cookie headers
  const setCookie = resp.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    cookies.push(c.split(";")[0]);
  }
  return resp.text();
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

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username");
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return Response.json({ error: "Invalid username" }, { status: 400 });
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
      { headers: HEADERS }
    );
    const rssXml = await rssResp.text();
    const rssEntries = parseRSS(rssXml);

    // 3. Try to scrape rated films pages (may fail due to Cloudflare)
    const scrapedFilms: ReturnType<typeof parseRatedFilms> = [];
    try {
      for (let page = 1; page <= 3; page++) {
        const html = await fetchPage(
          `https://letterboxd.com/${username}/films/ratings/page/${page}/`,
          cookies
        );
        if (html.includes("Just a moment")) break;
        const films = parseRatedFilms(html);
        if (films.length === 0) break;
        scrapedFilms.push(...films);
      }
    } catch {
      // Cloudflare blocked — fall through to RSS-based stats
    }

    // 4. Compute stats — use scraped films if available, otherwise RSS
    const useScraped = scrapedFilms.length > 0;

    // Build unified film list from RSS (always available)
    const rssFilms = rssEntries
      .filter((e) => e.rating !== null)
      .map((e) => ({
        title: e.filmTitle,
        slug: "",
        year: e.filmYear,
        rating: e.rating,
        filmId: "",
      }));

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

    return Response.json({
      profile,
      stats: {
        totalRated: rated.length,
        totalFilms: allFilms.length,
        avgRating,
        ratingDistribution: ratingDist,
        decadeDistribution: decadeDist,
        topRated,
        recentActivity,
        source: useScraped ? "scraped" : "rss",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
