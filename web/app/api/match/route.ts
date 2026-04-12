import { NextRequest } from "next/server";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

interface RSSFilm {
  title: string;
  year: number | null;
  rating: number | null;
}

function parseRSSForRatings(xml: string): RSSFilm[] {
  const films: RSSFilm[] = [];
  const items = xml.split("<item>");
  for (const item of items.slice(1)) {
    const get = (tag: string) =>
      item
        .match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]
        ?.trim() ?? "";

    const filmTitle = get("letterboxd:filmTitle");
    const filmYearStr = get("letterboxd:filmYear");
    const ratingStr = get("letterboxd:memberRating");

    if (!filmTitle) continue;

    films.push({
      title: filmTitle,
      year: filmYearStr ? parseInt(filmYearStr, 10) : null,
      rating: ratingStr ? parseFloat(ratingStr) : null,
    });
  }
  return films;
}

function buildRatingMap(films: RSSFilm[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of films) {
    if (f.rating !== null) {
      const key = `${f.title.toLowerCase()} (${f.year ?? "?"})`;
      if (!map.has(key)) map.set(key, f.rating);
    }
  }
  return map;
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>
): number {
  const shared = [...a.keys()].filter((k) => b.has(k));
  if (shared.length === 0) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (const k of shared) {
    dot += a.get(k)! * b.get(k)!;
    magA += a.get(k)! ** 2;
    magB += b.get(k)! ** 2;
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
    const [userRss, friendRss] = await Promise.all([
      fetch(`https://letterboxd.com/${username}/rss/`, {
        headers: HEADERS,
      }).then((r) => r.text()),
      fetch(`https://letterboxd.com/${friend}/rss/`, {
        headers: HEADERS,
      }).then((r) => r.text()),
    ]);

    const userFilms = parseRSSForRatings(userRss);
    const friendFilms = parseRSSForRatings(friendRss);
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
      });
    }

    const diffs = sharedKeys.map((k) =>
      Math.abs(userMap.get(k)! - friendMap.get(k)!)
    );
    const avgDiff =
      Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 100) /
      100;
    const cosSim =
      Math.round(cosineSimilarity(userMap, friendMap) * 1000) / 1000;

    const overlapNorm = Math.min(overlap / 20, 1);
    const agreementNorm = 1 - avgDiff / 5;
    const score =
      Math.round((0.3 * overlapNorm + 0.3 * agreementNorm + 0.4 * cosSim) * 1000) /
      10;

    const sharedFilms = sharedKeys.slice(0, 15).map((k) => ({
      title: k,
      yourRating: userMap.get(k)!,
      theirRating: friendMap.get(k)!,
    }));

    return Response.json({
      username: friend,
      overlapCount: overlap,
      avgDifference: avgDiff,
      cosineSimilarity: cosSim,
      score,
      sharedFilms,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
