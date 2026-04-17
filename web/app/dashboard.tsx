"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import { type CSVFilm, extractRatingsFromFile } from "./csv-utils";

/** Build a TMDB CDN URL from a poster path. Sizes: w92, w154, w185, w342, w500, w780, original. */
function tmdbImg(
  path: string | undefined,
  size: "w92" | "w154" | "w185" | "w342" | "w500" | "w780" = "w185"
): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

interface Film {
  title: string;
  slug: string;
  year: number | null;
  rating: number | null;
  filmId: string;
}

interface RSSEntry {
  filmTitle: string;
  filmYear: number | null;
  rating: number | null;
  watchDate: string;
  isRewatch: boolean;
  posterUrl: string;
  link: string;
}

interface StatsData {
  profile: {
    displayName: string;
    bio: string;
    filmsWatched: number;
    following: number;
    followers: number;
    listsCount: number;
    favorites: string[];
  };
  stats: {
    totalRated: number;
    totalFilms: number;
    avgRating: number;
    ratingDistribution: Record<string, number>;
    decadeDistribution: Record<string, number>;
    topRated: Film[];
    recentActivity: RSSEntry[];
    rewatchCount: number;
    allSlugs: string[];
    source: "scraped" | "rss" | "csv";
  };
}

interface FilmDetail {
  slug: string;
  directors: string[];
  genres: string[];
  actors: string[];
  runtime?: number;
  countries?: string[];
  // TMDB enrichment — all optional, UI falls back to text if absent.
  tmdbId?: number;
  tmdbType?: "movie" | "tv";
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  tagline?: string;
}

interface MatchResult {
  mode?: "ratings" | "taste";
  username: string;
  overlapCount: number;
  avgDifference?: number;
  cosineSimilarity?: number;
  score: number;
  sharedFilms?: {
    title: string;
    yourRating: number;
    theirRating: number;
    slug?: string;
  }[];
  sharedSlugs?: string[];
  userTotal?: number;
  friendTotal?: number;
  dataLimited?: boolean;
  // Taste-mode fields
  breakdown?: {
    watchedJaccard: number;
    likedOverlap: number;
    watchlistBridge: number;
    sharedLoved: number;
  };
  bothLoved?: string[];
  bothWatched?: string[];
  theyLovedYouHavent?: string[];
  userLikes?: number;
  friendLikes?: number;
}

/* ---------- helper components ---------- */

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return (
    <span className="text-accent text-sm whitespace-nowrap">
      {"★".repeat(full)}
      {half && "½"}
    </span>
  );
}

function RatingBar({
  rating,
  count,
  maxCount,
}: {
  rating: number;
  count: number;
  maxCount: number;
}) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-16 text-right">
        <Stars rating={rating} />
      </div>
      <div className="flex-1 h-6 bg-background rounded overflow-hidden">
        <div
          className="h-full bg-accent/70 rounded transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-8 text-right text-muted text-xs">{count}</div>
    </div>
  );
}

function LeaderboardItem({
  rank,
  name,
  count,
}: {
  rank: number;
  name: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className="text-muted w-5 text-right">{rank}</span>
      <span className="flex-1">{name}</span>
      <span className="text-muted text-xs">
        {count} film{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

function EnrichingPlaceholder() {
  return (
    <div className="text-muted text-sm py-4 text-center min-h-[200px] flex flex-col items-center justify-center gap-3">
      <span className="inline-block animate-spin text-xl">&#9696;</span>
      <span className="animate-pulse">Loading...</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
}

/**
 * Poster thumbnail backed by TMDB. Width/height match TMDB's 2:3 aspect ratio.
 * Falls back to a placeholder slate card with the slug when no poster is
 * available (film page had no TMDB link, or TMDB returned no poster).
 */
function Poster({
  posterPath,
  title,
  slug,
  size = 60,
  href,
}: {
  posterPath?: string;
  title: string;
  slug?: string;
  size?: number;
  href?: string;
}) {
  const url = tmdbImg(posterPath, size <= 92 ? "w92" : size <= 154 ? "w154" : "w185");
  const width = size;
  const height = Math.round(size * 1.5); // 2:3 poster aspect

  const inner = url ? (
    <Image
      src={url}
      alt={title}
      width={width}
      height={height}
      className="rounded shadow-md bg-card-border object-cover"
      unoptimized
    />
  ) : (
    <div
      className="rounded bg-card-border flex items-center justify-center text-[10px] text-muted text-center p-1 overflow-hidden"
      style={{ width, height }}
      title={title}
    >
      {title}
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 block hover:opacity-80 transition-opacity"
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="shrink-0" title={slug}>
      {inner}
    </div>
  );
}

/* ---------- CSV → StatsData merge ---------- */

function mergeCSVIntoStats(
  films: CSVFilm[],
  original: StatsData
): StatsData {
  const rated = films.filter(
    (f): f is CSVFilm & { rating: number } => f.rating != null
  );
  const avgRating =
    rated.length > 0
      ? Math.round(
          (rated.reduce((s, f) => s + f.rating, 0) / rated.length) * 100
        ) / 100
      : 0;

  const ratingDist: Record<string, number> = {};
  for (const f of rated) {
    const key = String(f.rating);
    ratingDist[key] = (ratingDist[key] ?? 0) + 1;
  }

  const decadeDist: Record<string, number> = {};
  for (const f of films) {
    if (f.year) {
      const decade = `${Math.floor(f.year / 10) * 10}s`;
      decadeDist[decade] = (decadeDist[decade] ?? 0) + 1;
    }
  }

  const topRated = [...rated]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10)
    .map((f) => ({
      title: f.title,
      slug: f.slug,
      year: f.year,
      rating: f.rating,
      filmId: "",
    }));

  const allSlugs = [...new Set(films.map((f) => f.slug).filter(Boolean))];

  return {
    profile: original.profile,
    stats: {
      ...original.stats, // keep recentActivity, rewatchCount
      totalRated: rated.length,
      totalFilms: films.length,
      avgRating,
      ratingDistribution: ratingDist,
      decadeDistribution: decadeDist,
      topRated,
      allSlugs,
      source: "csv",
    },
  };
}

/** Did this user provide meaningful star ratings? Governs the rating-mode UI. */
function usersHasRatings(
  csvFilms: CSVFilm[] | null,
  stats: StatsData["stats"]
): boolean {
  if (csvFilms) return csvFilms.some((f) => f.rating != null);
  return stats.totalRated > 0;
}

/* ========== Dashboard (root) ========== */

export default function Dashboard() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<StatsData | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;

    setLoading(true);
    setError("");
    setData(null);

    try {
      const resp = await fetch(
        `/api/stats?username=${encodeURIComponent(name)}`
      );
      const json = await resp.json();
      if (!resp.ok) {
        setError(json.error || "Failed to fetch stats");
      } else {
        setData(json);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Search Form */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-3 max-w-md mx-auto mb-10"
      >
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter Letterboxd username"
          className="flex-1 px-4 py-3 rounded-lg bg-card border border-card-border text-foreground placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="px-6 py-3 rounded-lg bg-accent text-background font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="inline-block animate-spin">&#9696;</span>
          ) : (
            "Go"
          )}
        </button>
      </form>

      {error && (
        <div className="text-center text-red-400 mb-6">{error}</div>
      )}

      {loading && (
        <div className="text-center text-muted py-12">
          <div className="text-2xl animate-pulse mb-2">&#127916;</div>
          <p>Fetching stats for {username}...</p>
          <p className="text-sm mt-1">This may take a few seconds.</p>
        </div>
      )}

      {data && <StatsView data={data} username={username.trim()} />}
    </div>
  );
}

/* ========== StatsView ========== */

function StatsView({
  data: originalData,
  username,
}: {
  data: StatsData;
  username: string;
}) {
  // CSV upload state
  const [csvFilms, setCsvFilms] = useState<CSVFilm[] | null>(null);
  const [csvError, setCsvError] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Merge CSV data when available (memoized to keep stable references for useCallback/useEffect)
  const data = useMemo(
    () => (csvFilms ? mergeCSVIntoStats(csvFilms, originalData) : originalData),
    [csvFilms, originalData]
  );
  const { profile, stats } = data;

  // Enrichment state
  const [filmDetails, setFilmDetails] = useState<FilmDetail[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(0);

  // Match state
  const [showMatch, setShowMatch] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  /* ---------- CSV upload handlers ---------- */

  async function processFile(file: File) {
    if (
      !file.name.toLowerCase().endsWith(".csv") &&
      !file.name.toLowerCase().endsWith(".zip")
    ) {
      setCsvError("Please upload a .zip or .csv file.");
      return;
    }

    setCsvLoading(true);
    setCsvError("");

    try {
      const films = await extractRatingsFromFile(file);
      if (films.length === 0) {
        setCsvError(
          "No films found. Make sure this is your Letterboxd data export (ZIP or ratings.csv)."
        );
        return;
      }
      setCsvFilms(films);
      // Reset enrichment so it restarts with new slugs
      setFilmDetails([]);
      setEnrichProgress(0);
    } catch (e) {
      setCsvError(
        e instanceof Error ? e.message : "Failed to read the file."
      );
    } finally {
      setCsvLoading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  /* ---------- enrichment ---------- */

  const enrichFilms = useCallback(async () => {
    const slugs = stats.allSlugs;
    if (!slugs || slugs.length === 0) return;

    setEnriching(true);
    setEnrichProgress(0);
    setFilmDetails([]);
    const allDetails: FilmDetail[] = [];

    for (let i = 0; i < slugs.length; i += 15) {
      const batch = slugs.slice(i, i + 15);
      const batchIndex = i / 15;
      try {
        const resp = await fetch("/api/film-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs: batch }),
        });
        if (resp.ok) {
          const json = await resp.json();
          allDetails.push(...(json.films ?? []));
          // Update leaderboard UI every 3 batches to reduce re-renders
          if (batchIndex % 3 === 2 || i + 15 >= slugs.length) {
            setFilmDetails([...allDetails]);
          }
        }
      } catch {
        // Continue with what we have
      }
      setEnrichProgress(Math.min(i + 15, slugs.length));
    }
    setFilmDetails([...allDetails]);

    setEnriching(false);
  }, [stats.allSlugs]);

  useEffect(() => {
    enrichFilms();
  }, [enrichFilms]);

  // Compute leaderboards from film details (memoized to avoid recalc on unrelated renders)
  const { topDirectors, topGenres, topActors } = useMemo(() => {
    const directorCounts = new Map<string, number>();
    const genreCounts = new Map<string, number>();
    const actorCounts = new Map<string, number>();

    for (const film of filmDetails) {
      for (const d of film.directors) {
        directorCounts.set(d, (directorCounts.get(d) ?? 0) + 1);
      }
      for (const g of film.genres) {
        genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
      }
      for (const a of film.actors) {
        actorCounts.set(a, (actorCounts.get(a) ?? 0) + 1);
      }
    }

    return {
      topDirectors: [...directorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      topGenres: [...genreCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      topActors: [...actorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
    };
  }, [filmDetails]);

  // Build slug → rating lookup from CSV films or topRated + recentActivity
  const ratingBySlug = useMemo(() => {
    const map = new Map<string, number>();
    if (csvFilms) {
      for (const f of csvFilms) {
        if (f.slug && f.rating != null) map.set(f.slug, f.rating);
      }
    } else {
      for (const f of stats.topRated) {
        if (f.slug && f.rating != null) map.set(f.slug, f.rating);
      }
      for (const e of stats.recentActivity) {
        if (e.rating != null) {
          const slug = e.link?.match(/\/film\/([^/]+)/)?.[1];
          if (slug) map.set(slug, e.rating);
        }
      }
    }
    return map;
  }, [csvFilms, stats.topRated, stats.recentActivity]);

  // Build slug → posterPath lookup from enriched film details. Propagates TMDB
  // posters wherever we render a film slug in the UI. Empty until enrichment
  // starts populating filmDetails; once it does, posters appear progressively.
  const posterBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of filmDetails) {
      if (f.posterPath) map.set(f.slug, f.posterPath);
    }
    return map;
  }, [filmDetails]);

  // Build slug → year lookup
  const yearBySlug = useMemo(() => {
    const map = new Map<string, number>();
    if (csvFilms) {
      for (const f of csvFilms) {
        if (f.slug && f.year) map.set(f.slug, f.year);
      }
    } else {
      for (const f of stats.topRated) {
        if (f.slug && f.year) map.set(f.slug, f.year);
      }
    }
    return map;
  }, [csvFilms, stats.topRated]);

  // 1. Cinematic Age — rating-weighted average film year
  const cinematicAge = useMemo(() => {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const [slug, rating] of ratingBySlug) {
      const year = yearBySlug.get(slug);
      if (year) {
        weightedSum += year * rating;
        weightTotal += rating;
      }
    }
    if (weightTotal === 0) return null;
    const weightedAvgYear = Math.round(weightedSum / weightTotal);
    const estimatedBirthYear = weightedAvgYear - 18;
    const currentYear = new Date().getFullYear();
    const age = currentYear - estimatedBirthYear;
    const decade = `${Math.floor(weightedAvgYear / 10) * 10}s`;
    return { age, decade, weightedAvgYear };
  }, [ratingBySlug, yearBySlug]);

  // 2. Director-Actor Power Duos
  const powerDuos = useMemo(() => {
    const pairCounts = new Map<string, number>();
    for (const film of filmDetails) {
      for (const dir of film.directors) {
        for (const act of film.actors) {
          const key = `${dir}|||${act}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
    return [...pairCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => {
        const [director, actor] = key.split("|||");
        return { director, actor, count };
      });
  }, [filmDetails]);

  // 3. Genre Taste Profile — avg rating per genre
  const genreTaste = useMemo(() => {
    const genreRatings = new Map<string, { sum: number; count: number }>();
    for (const film of filmDetails) {
      const rating = ratingBySlug.get(film.slug);
      if (rating == null) continue;
      for (const g of film.genres) {
        const entry = genreRatings.get(g) ?? { sum: 0, count: 0 };
        entry.sum += rating;
        entry.count += 1;
        genreRatings.set(g, entry);
      }
    }
    return [...genreRatings.entries()]
      .filter(([, v]) => v.count >= 3)
      .map(([genre, v]) => ({ genre, avg: Math.round((v.sum / v.count) * 100) / 100, count: v.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [filmDetails, ratingBySlug]);

  // 4. Five-Star Club — common traits of top-rated films
  const fiveStarClub = useMemo(() => {
    const threshold = ratingBySlug.size > 0 ? 5 : 0;
    let topSlugs = [...ratingBySlug.entries()].filter(([, r]) => r >= threshold).map(([s]) => s);
    // Fall back to 4.5+ if fewer than 3 five-star films
    if (topSlugs.length < 3) {
      topSlugs = [...ratingBySlug.entries()].filter(([, r]) => r >= 4.5).map(([s]) => s);
    }
    if (topSlugs.length === 0) return null;

    const topFilms = filmDetails.filter((f) => topSlugs.includes(f.slug));
    const dirCounts = new Map<string, number>();
    const genCounts = new Map<string, number>();
    const actCounts = new Map<string, number>();
    for (const f of topFilms) {
      for (const d of f.directors) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      for (const g of f.genres) genCounts.set(g, (genCounts.get(g) ?? 0) + 1);
      for (const a of f.actors) actCounts.set(a, (actCounts.get(a) ?? 0) + 1);
    }

    return {
      count: topSlugs.length,
      threshold: topSlugs.length === [...ratingBySlug.entries()].filter(([, r]) => r >= 5).length ? 5 : 4.5,
      topGenres: [...genCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topDirectors: [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topActors: [...actCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [filmDetails, ratingBySlug]);

  // 5. Runtime Stats
  const runtimeStats = useMemo(() => {
    const withRuntime = filmDetails.filter((f) => f.runtime && f.runtime > 0);
    if (withRuntime.length === 0) return null;
    const totalMins = withRuntime.reduce((s, f) => s + (f.runtime ?? 0), 0);
    const avgMins = Math.round(totalMins / withRuntime.length);
    const sorted = [...withRuntime].sort((a, b) => (b.runtime ?? 0) - (a.runtime ?? 0));
    return {
      totalHours: Math.round(totalMins / 60),
      avgMins,
      longest: sorted[0],
      shortest: sorted[sorted.length - 1],
    };
  }, [filmDetails]);

  // 6. Country Explorer
  const countryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const film of filmDetails) {
      for (const c of film.countries ?? []) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
        total++;
      }
    }
    if (total === 0) return [];
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, count]) => ({ country, count, pct: Math.round((count / total) * 100) }));
  }, [filmDetails]);

  /* ---------- match ---------- */

  async function handleMatch(e: React.FormEvent) {
    e.preventDefault();
    const friend = friendName.trim();
    if (!friend) return;

    setMatchLoading(true);
    setMatchError("");
    setMatchResult(null);

    try {
      let resp;
      if (csvFilms) {
        // POST user's CSV films so the server doesn't need to scrape them.
        // Include liked + watchlist slugs so the server can run taste-mode
        // scoring without having to re-scrape those pages for our own user.
        const userLikedSlugs = csvFilms
          .filter((f) => f.liked)
          .map((f) => f.slug)
          .filter(Boolean);
        const userWatchlistSlugs = csvFilms
          .filter((f) => f.watchlisted)
          .map((f) => f.slug)
          .filter(Boolean);

        resp = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            friend,
            userFilms: csvFilms.map((f) => ({
              title: f.title,
              year: f.year,
              rating: f.rating,
              slug: f.slug,
            })),
            userLikedSlugs,
            userWatchlistSlugs,
          }),
        });
      } else {
        resp = await fetch(
          `/api/match?username=${encodeURIComponent(username)}&friend=${encodeURIComponent(friend)}`
        );
      }

      const json = await resp.json();
      if (!resp.ok) {
        setMatchError(json.error || "Failed to compare");
      } else {
        setMatchResult(json);
      }
    } catch {
      setMatchError("Network error. Please try again.");
    } finally {
      setMatchLoading(false);
    }
  }

  /* ---------- derived display data ---------- */

  const hasRatings = usersHasRatings(csvFilms, stats);

  const ratingEntries = Object.entries(stats.ratingDistribution)
    .map(([k, v]) => [parseFloat(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const maxCount =
    ratingEntries.length > 0
      ? Math.max(...ratingEntries.map(([, v]) => v))
      : 0;

  const decadeEntries = Object.entries(stats.decadeDistribution).sort(
    (a, b) => a[0].localeCompare(b[0])
  );

  // No-ratings variants: decade fingerprint derived from ALL films (not weighted).
  // Replaces the ratings-only "Cinematic Age" when the user has no stars.
  const decadeFingerprint = useMemo(() => {
    if (hasRatings) return null;
    const years: number[] = [];
    if (csvFilms) {
      for (const f of csvFilms) if (f.year) years.push(f.year);
    } else {
      for (const f of stats.topRated) if (f.year) years.push(f.year);
    }
    if (years.length === 0) return null;
    const avg = Math.round(years.reduce((s, y) => s + y, 0) / years.length);
    const decade = `${Math.floor(avg / 10) * 10}s`;
    // Spread (standard deviation) — low = "you only watch one era", high = "eclectic".
    const variance =
      years.reduce((s, y) => s + (y - avg) ** 2, 0) / years.length;
    const spread = Math.round(Math.sqrt(variance));
    return { avgYear: avg, decade, spread, count: years.length };
  }, [hasRatings, csvFilms, stats.topRated]);

  // Watchlist vs. Watched "completionist" stat — only meaningful with CSV data
  // that includes the watchlist.csv column. Null otherwise.
  const watchlistStats = useMemo(() => {
    if (!csvFilms) return null;
    const watchlistSlugs = new Set(
      csvFilms.filter((f) => f.watchlisted).map((f) => f.slug)
    );
    if (watchlistSlugs.size === 0) return null;
    // Watchlist entries are films NOT yet watched, so no overlap by construction
    // unless the user has since watched them and left them on the list. Report
    // total watchlist size and estimate "completion" as (watched ∩ historic watchlist),
    // but since we only have current state, surface the count as-is.
    return {
      watchlistSize: watchlistSlugs.size,
      likedSize: csvFilms.filter((f) => f.liked).length,
    };
  }, [csvFilms]);

  // "Liked Films Club" — when we have likes but no ratings, analyze what the
  // user's hearted films have in common (genres, directors, actors).
  const likedFilmsClub = useMemo(() => {
    if (hasRatings) return null;
    if (!csvFilms) return null;
    const likedSlugs = new Set(
      csvFilms.filter((f) => f.liked).map((f) => f.slug)
    );
    if (likedSlugs.size === 0) return null;

    const likedFilms = filmDetails.filter((f) => likedSlugs.has(f.slug));
    const dirCounts = new Map<string, number>();
    const genCounts = new Map<string, number>();
    const actCounts = new Map<string, number>();
    for (const f of likedFilms) {
      for (const d of f.directors) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      for (const g of f.genres) genCounts.set(g, (genCounts.get(g) ?? 0) + 1);
      for (const a of f.actors) actCounts.set(a, (actCounts.get(a) ?? 0) + 1);
    }

    return {
      count: likedSlugs.size,
      topGenres: [...genCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topDirectors: [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topActors: [...actCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [hasRatings, csvFilms, filmDetails]);

  /* ---------- render ---------- */
  return (
    <div className="space-y-8">
      {/* Profile Header */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold">
              {profile.displayName || "User"}
            </h2>
            {profile.bio && (
              <p className="text-muted text-sm mt-1 max-w-lg">
                {profile.bio}
              </p>
            )}
          </div>
          <a
            href={`https://letterboxd.com/${username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent text-sm hover:text-accent-hover"
          >
            View on Letterboxd &rarr;
          </a>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
          <StatCard label="Films" value={profile.filmsWatched} />
          <StatCard label="Following" value={profile.following} />
          <StatCard label="Followers" value={profile.followers} />
          <StatCard label="Lists" value={profile.listsCount} />
          <StatCard label="Rewatches" value={stats.rewatchCount} />
        </div>

        {profile.favorites.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-1.5">
              Favorites
            </p>
            <div className="flex flex-wrap gap-2">
              {profile.favorites.map((f) => (
                <span
                  key={f}
                  className="bg-background px-2.5 py-1 rounded text-sm"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats Row — swap rating-centric tiles for watched/liked/watchlist when
           the user doesn't use star ratings. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {hasRatings ? (
          <>
            <div className="bg-card border border-card-border rounded-xl p-5 text-center">
              <div className="text-3xl font-bold text-accent">
                {stats.avgRating}
              </div>
              <div className="text-muted text-sm mt-1">Average Rating</div>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5 text-center">
              <div className="text-3xl font-bold">{stats.totalRated}</div>
              <div className="text-muted text-sm mt-1">Films Rated</div>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5 text-center">
              <div className="text-3xl font-bold">{stats.totalFilms}</div>
              <div className="text-muted text-sm mt-1">Total Tracked</div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-card border border-card-border rounded-xl p-5 text-center">
              <div className="text-3xl font-bold text-accent">
                {stats.totalFilms.toLocaleString()}
              </div>
              <div className="text-muted text-sm mt-1">Films Watched</div>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5 text-center">
              <div className="text-3xl font-bold">
                {watchlistStats?.likedSize ?? "—"}
              </div>
              <div className="text-muted text-sm mt-1">Films Liked</div>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5 text-center">
              <div className="text-3xl font-bold">
                {watchlistStats?.watchlistSize ?? "—"}
              </div>
              <div className="text-muted text-sm mt-1">On Watchlist</div>
            </div>
          </>
        )}
      </div>

      {/* ── CSV Upload / Data Source Banner ── */}

      {/* Prominent upload prompt when data is limited (RSS only) */}
      {stats.source === "rss" && (
        <div className="bg-card border border-accent/40 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-1">
            Get your complete stats
          </h3>
          <p className="text-muted text-sm mb-4">
            We could only load your ~{stats.totalFilms} most recent films.
            Upload your Letterboxd data export (ZIP) for complete stats —
            including likes and watchlist, so non-raters get a full profile too.
          </p>

          <ol className="text-sm space-y-2 mb-5">
            <li className="flex gap-2">
              <span className="text-accent font-mono font-bold">1.</span>
              <span>
                Open{" "}
                <a
                  href="https://letterboxd.com/settings/data/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-hover underline"
                >
                  letterboxd.com/settings/data/
                </a>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-accent font-mono font-bold">2.</span>
              <span>
                Click{" "}
                <strong className="text-foreground">
                  &ldquo;Export Your Data&rdquo;
                </strong>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-accent font-mono font-bold">3.</span>
              <span>Upload the downloaded ZIP (or just ratings.csv) below</span>
            </li>
          </ol>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-accent bg-accent/5"
                : "border-card-border hover:border-accent/60"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.csv"
              onChange={handleFileInput}
              className="hidden"
            />
            {csvLoading ? (
              <div className="text-muted">
                <span className="inline-block animate-spin text-xl">
                  &#9696;
                </span>
                <p className="mt-2 text-sm">Processing your data...</p>
              </div>
            ) : (
              <>
                <p className="text-muted">
                  Drop your file here, or{" "}
                  <span className="text-accent underline">click to browse</span>
                </p>
                <p className="text-xs text-muted/60 mt-1">
                  Accepts .zip or .csv
                </p>
              </>
            )}
          </div>

          {csvError && (
            <p className="text-red-400 text-sm mt-3">{csvError}</p>
          )}
        </div>
      )}

      {/* Smaller upload option when scraping worked */}
      {stats.source === "scraped" && (
        <details className="bg-card border border-card-border rounded-xl">
          <summary className="px-6 py-4 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
            Have your Letterboxd data export? Upload the ZIP for complete stats
            (including likes &amp; watchlist — great if you don&apos;t rate)
          </summary>
          <div className="px-6 pb-5">
            <ol className="text-sm space-y-1.5 mb-4 text-muted">
              <li>
                <span className="text-accent font-mono">1.</span> Open{" "}
                <a
                  href="https://letterboxd.com/settings/data/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-hover underline"
                >
                  letterboxd.com/settings/data/
                </a>
              </li>
              <li>
                <span className="text-accent font-mono">2.</span> Click{" "}
                <strong className="text-foreground">
                  &ldquo;Export Your Data&rdquo;
                </strong>
              </li>
              <li>
                <span className="text-accent font-mono">3.</span> Upload the
                ZIP or ratings.csv below
              </li>
            </ol>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-accent bg-accent/5"
                  : "border-card-border hover:border-accent/60"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.csv"
                onChange={handleFileInput}
                className="hidden"
              />
              {csvLoading ? (
                <div className="text-muted">
                  <span className="inline-block animate-spin text-xl">
                    &#9696;
                  </span>
                  <p className="mt-2 text-sm">Processing your data...</p>
                </div>
              ) : (
                <p className="text-muted text-sm">
                  Drop file here or{" "}
                  <span className="text-accent underline">browse</span>{" "}
                  <span className="text-muted/60">(.zip or .csv)</span>
                </p>
              )}
            </div>

            {csvError && (
              <p className="text-red-400 text-sm mt-3">{csvError}</p>
            )}
          </div>
        </details>
      )}

      {/* Success banner after CSV import */}
      {stats.source === "csv" && csvFilms && (
        <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-3 flex items-center justify-center gap-2">
          <span className="text-accent">&#10003;</span>
          <p className="text-accent text-sm font-medium">
            Loaded {csvFilms.length.toLocaleString()} film
            {csvFilms.length !== 1 ? "s" : ""} from your export
            {watchlistStats && watchlistStats.likedSize > 0 && (
              <> · {watchlistStats.likedSize} liked</>
            )}
            {watchlistStats && watchlistStats.watchlistSize > 0 && (
              <> · {watchlistStats.watchlistSize} on watchlist</>
            )}
          </p>
        </div>
      )}

      {/* Rating Distribution — only meaningful if the user rates films. */}
      {hasRatings && ratingEntries.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Rating Distribution</h3>
          <div className="space-y-2">
            {ratingEntries.map(([rating, count]) => (
              <RatingBar
                key={rating}
                rating={rating}
                count={count}
                maxCount={maxCount}
              />
            ))}
          </div>
        </div>
      )}

      {/* Rating-free user banner — explains why the "star-based" cards are gone
           and reassures them that the match + insights still work. */}
      {!hasRatings && stats.totalFilms > 0 && (
        <div className="bg-card border border-accent/30 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-accent mb-1">
            No star ratings? No problem.
          </h3>
          <p className="text-muted text-sm">
            You log films without rating them — same here. We&apos;ll use your
            watched list, likes, and watchlist to build your stats and match you
            with friends on what you actually watch and love.
          </p>
        </div>
      )}

      {/* Most Watched Directors / Genres / Actors */}
      {(stats.allSlugs?.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">
              Most Watched Directors
            </h3>
            {topDirectors.length > 0 ? (
              <div>
                {topDirectors.map(([name, count], i) => (
                  <LeaderboardItem
                    key={name}
                    rank={i + 1}
                    name={name}
                    count={count}
                  />
                ))}
              </div>
            ) : (
              <EnrichingPlaceholder />
            )}
          </div>

          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">
              Most Watched Genres
            </h3>
            {topGenres.length > 0 ? (
              <div>
                {topGenres.map(([name, count], i) => (
                  <LeaderboardItem
                    key={name}
                    rank={i + 1}
                    name={name}
                    count={count}
                  />
                ))}
              </div>
            ) : (
              <EnrichingPlaceholder />
            )}
          </div>

          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">
              Most Watched Actors
            </h3>
            {topActors.length > 0 ? (
              <div>
                {topActors.map(([name, count], i) => (
                  <LeaderboardItem
                    key={name}
                    rank={i + 1}
                    name={name}
                    count={count}
                  />
                ))}
              </div>
            ) : (
              <EnrichingPlaceholder />
            )}
          </div>
        </div>
      )}

      <div className={`transition-opacity ${enriching ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="w-full max-w-md mx-auto">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="inline-block animate-spin text-sm">&#9696;</span>
            <p className="text-muted text-xs text-center">
              Enriching film details... {enrichProgress}/{stats.allSlugs?.length ?? 0}{" "}
              films processed
            </p>
          </div>
          <div className="w-full bg-card-border rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-accent h-full rounded-full transition-all duration-300"
              style={{ width: `${stats.allSlugs?.length ? (enrichProgress / stats.allSlugs.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* ---- Insights Section ---- */}
      {filmDetails.length > 0 && (
        <>
          {/* Row 1: Cinematic Age (ratings) OR Decade Fingerprint (no ratings) + Power Duos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Cinematic Age — rating-weighted */}
            {hasRatings && cinematicAge && (
              <div className="bg-card border border-card-border rounded-xl p-6 text-center">
                <h3 className="text-lg font-semibold mb-3">Your Cinematic Age</h3>
                <div className="text-5xl font-bold text-accent mb-2">{cinematicAge.age}</div>
                <p className="text-muted text-sm">
                  Your taste was shaped in the <span className="text-foreground font-medium">{cinematicAge.decade}</span>
                </p>
              </div>
            )}

            {/* Decade Fingerprint — rating-free equivalent: unweighted avg year + spread */}
            {!hasRatings && decadeFingerprint && (
              <div className="bg-card border border-card-border rounded-xl p-6 text-center">
                <h3 className="text-lg font-semibold mb-3">Your Decade</h3>
                <div className="text-5xl font-bold text-accent mb-2">
                  {decadeFingerprint.decade}
                </div>
                <p className="text-muted text-sm">
                  You gravitate toward films from{" "}
                  <span className="text-foreground font-medium">
                    {decadeFingerprint.avgYear}
                  </span>
                  {decadeFingerprint.spread <= 8
                    ? " — a loyalist to one era"
                    : decadeFingerprint.spread <= 18
                      ? " — with a healthy range"
                      : " — and you're all over the timeline"}
                </p>
              </div>
            )}

            {/* Director-Actor Power Duos */}
            {powerDuos.length > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">Power Duos</h3>
                <div className="space-y-3">
                  {powerDuos.map(({ director, actor, count }, i) => (
                    <div key={`${director}-${actor}`} className="flex items-center gap-3">
                      <span className="text-accent font-bold text-lg">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{director} + {actor}</div>
                        <div className="text-muted text-xs">{count} film{count !== 1 ? "s" : ""} together</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Genre Taste Profile — only shown when ratings exist (it's avg-rating per genre) */}
          {hasRatings && genreTaste.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Genre Taste Profile</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {genreTaste.map(({ genre, avg, count }) => (
                  <div key={genre} className="bg-background rounded-lg px-3 py-2.5 text-center">
                    <div className="text-sm font-medium truncate">{genre}</div>
                    <div className="text-accent font-bold">{avg.toFixed(1)}<span className="text-xs text-muted">/5</span></div>
                    <div className="text-xs text-muted">{count} films</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Row 3: 5-Star Club (ratings) / Liked Films Club (no ratings) + Runtime Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 5-Star Club — rating-based */}
            {hasRatings && fiveStarClub && fiveStarClub.count > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-1">
                  {fiveStarClub.threshold === 5 ? "5-Star" : "4.5+ Star"} Club
                </h3>
                <p className="text-muted text-xs mb-4">{fiveStarClub.count} films — here&apos;s what they share</p>
                {fiveStarClub.topGenres.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Genres</div>
                    <div className="flex flex-wrap gap-1.5">
                      {fiveStarClub.topGenres.map(([name, count]) => (
                        <span key={name} className="bg-accent/15 text-accent text-xs px-2 py-0.5 rounded-full">
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {fiveStarClub.topDirectors.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Directors</div>
                    <div className="flex flex-wrap gap-1.5">
                      {fiveStarClub.topDirectors.map(([name, count]) => (
                        <span key={name} className="bg-accent/15 text-accent text-xs px-2 py-0.5 rounded-full">
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {fiveStarClub.topActors.length > 0 && (
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Actors</div>
                    <div className="flex flex-wrap gap-1.5">
                      {fiveStarClub.topActors.map(([name, count]) => (
                        <span key={name} className="bg-accent/15 text-accent text-xs px-2 py-0.5 rounded-full">
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Liked Films Club — rating-free equivalent of 5-Star Club,
                 using hearts instead of stars. Only shows when we have liked
                 films (i.e. the user uploaded the full ZIP with likes/films.csv). */}
            {!hasRatings && likedFilmsClub && likedFilmsClub.count > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-1">Liked Films Club</h3>
                <p className="text-muted text-xs mb-4">
                  {likedFilmsClub.count} films you hearted — here&apos;s what they share
                </p>
                {likedFilmsClub.topGenres.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Genres</div>
                    <div className="flex flex-wrap gap-1.5">
                      {likedFilmsClub.topGenres.map(([name, count]) => (
                        <span key={name} className="bg-accent/15 text-accent text-xs px-2 py-0.5 rounded-full">
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {likedFilmsClub.topDirectors.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Directors</div>
                    <div className="flex flex-wrap gap-1.5">
                      {likedFilmsClub.topDirectors.map(([name, count]) => (
                        <span key={name} className="bg-accent/15 text-accent text-xs px-2 py-0.5 rounded-full">
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {likedFilmsClub.topActors.length > 0 && (
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Actors</div>
                    <div className="flex flex-wrap gap-1.5">
                      {likedFilmsClub.topActors.map(([name, count]) => (
                        <span key={name} className="bg-accent/15 text-accent text-xs px-2 py-0.5 rounded-full">
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Runtime Stats */}
            {runtimeStats && (
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">Runtime Stats</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-accent">{runtimeStats.totalHours.toLocaleString()}</div>
                    <div className="text-xs text-muted">hours watched</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{runtimeStats.avgMins}</div>
                    <div className="text-xs text-muted">avg minutes</div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Longest</span>
                    <span>{runtimeStats.longest.slug.replace(/-/g, " ")} ({runtimeStats.longest.runtime} min)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Shortest</span>
                    <span>{runtimeStats.shortest.slug.replace(/-/g, " ")} ({runtimeStats.shortest.runtime} min)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Row 4: Country Explorer */}
          {countryBreakdown.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Country Explorer</h3>
              <div className="space-y-2">
                {countryBreakdown.map(({ country, count, pct }) => (
                  <div key={country} className="flex items-center gap-3">
                    <span className="text-sm w-32 truncate">{country}</span>
                    <div className="flex-1 bg-background rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-accent/70 h-full rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-muted text-xs w-12 text-right">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Decade Distribution */}
      {decadeEntries.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Films by Decade</h3>
          <div className="flex flex-wrap gap-3">
            {decadeEntries.map(([decade, count]) => (
              <div
                key={decade}
                className="bg-background px-4 py-2.5 rounded-lg text-center"
              >
                <div className="text-lg font-bold">{count}</div>
                <div className="text-xs text-muted">{decade}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Rated — poster grid. Uses TMDB posters as they're fetched by the
           enrichment pass; falls back to a text tile for films we couldn't map. */}
      {hasRatings && stats.topRated.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Top Rated Films</h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-10 gap-3">
            {stats.topRated.map((film, i) => (
              <a
                key={`${film.slug}-${i}`}
                href={`https://letterboxd.com/film/${film.slug}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1.5 group"
              >
                <Poster
                  posterPath={posterBySlug.get(film.slug)}
                  title={film.title}
                  size={92}
                />
                <div className="text-center w-full">
                  <div className="text-xs font-medium truncate group-hover:text-accent transition-colors">
                    {film.title}
                  </div>
                  <Stars rating={film.rating!} />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {stats.recentActivity.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
          <div className="space-y-2">
            {stats.recentActivity.map((entry, i) => (
              <div
                key={`${entry.filmTitle}-${i}`}
                className="flex items-center gap-3 py-1.5 text-sm"
              >
                <span className="text-muted w-20 shrink-0">
                  {entry.watchDate || "—"}
                </span>
                <a
                  href={entry.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors truncate"
                >
                  {entry.filmTitle}
                </a>
                {entry.filmYear && (
                  <span className="text-muted shrink-0">
                    ({entry.filmYear})
                  </span>
                )}
                {entry.rating && <Stars rating={entry.rating} />}
                {entry.isRewatch && (
                  <span className="text-muted" title="Rewatch">
                    &#8635;
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Find Your Match */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-2">Find Your Match</h3>
        <p className="text-muted text-sm mb-2">
          {hasRatings
            ? "Compare your taste with another Letterboxd user based on shared ratings."
            : "Compare your taste with another Letterboxd user using what you watch and love — ratings not required."}
        </p>
        {/* Heads-up on the RSS fallback: if Cloudflare blocks the full ratings
            scrape for your friend (or their profile hasn't been cached), we
            only get ~50 of their most recent rated films from the RSS feed.
            A banner appears after the match when this happens. */}
        <p className="text-muted/70 text-xs mb-4">
          Heads up: if we can&apos;t scrape your friend&apos;s full ratings
          page, we fall back to their RSS feed — capped at their ~50 most
          recent rated films. You&apos;ll see a warning in the results when
          that happens.
        </p>

        {!showMatch ? (
          <button
            onClick={() => setShowMatch(true)}
            className="px-5 py-2.5 rounded-lg bg-accent text-background font-semibold hover:bg-accent-hover transition-colors"
          >
            Compare with a friend
          </button>
        ) : (
          <div>
            <form
              onSubmit={handleMatch}
              className="flex gap-3 max-w-md mb-4"
            >
              <input
                type="text"
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                placeholder="Friend's Letterboxd username"
                className="flex-1 px-4 py-2.5 rounded-lg bg-background border border-card-border text-foreground placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <button
                type="submit"
                disabled={matchLoading || !friendName.trim()}
                className="px-5 py-2.5 rounded-lg bg-accent text-background font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {matchLoading ? (
                  <span className="inline-block animate-spin">
                    &#9696;
                  </span>
                ) : (
                  "Match"
                )}
              </button>
            </form>

            {matchError && (
              <p className="text-red-400 text-sm mb-4">{matchError}</p>
            )}

            {matchResult && <MatchView result={matchResult} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== MatchView ========== */

function MatchView({ result }: { result: MatchResult }) {
  const [matchFilmDetails, setMatchFilmDetails] = useState<FilmDetail[]>([]);
  const [matchEnriching, setMatchEnriching] = useState(false);
  const [matchEnrichProgress, setMatchEnrichProgress] = useState(0);

  // Enrich shared films with directors/genres/actors — plus in taste mode, the
  // "they loved, you haven't seen" recommendations so we can show posters for
  // them too (the server doesn't include those in sharedSlugs).
  useEffect(() => {
    const base = result.sharedSlugs ?? [];
    const recs = result.theyLovedYouHavent ?? [];
    const slugs = [...new Set([...base, ...recs])].filter(Boolean);
    if (slugs.length === 0) return;

    let cancelled = false;
    async function enrich() {
      setMatchEnriching(true);
      setMatchEnrichProgress(0);
      const allDetails: FilmDetail[] = [];

      for (let i = 0; i < slugs.length; i += 15) {
        if (cancelled) break;
        const batch = slugs!.slice(i, i + 15);
        try {
          const resp = await fetch("/api/film-details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slugs: batch }),
          });
          if (resp.ok) {
            const json = await resp.json();
            allDetails.push(...(json.films ?? []));
            setMatchFilmDetails([...allDetails]);
          }
        } catch {
          // Continue with what we have
        }
        setMatchEnrichProgress(Math.min(i + 15, slugs.length));
      }

      setMatchEnriching(false);
    }

    enrich();
    return () => {
      cancelled = true;
    };
  }, [result.sharedSlugs, result.theyLovedYouHavent]);

  // Compute leaderboards from shared film details
  const directorCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();

  for (const film of matchFilmDetails) {
    for (const d of film.directors) {
      directorCounts.set(d, (directorCounts.get(d) ?? 0) + 1);
    }
    for (const g of film.genres) {
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
    for (const a of film.actors) {
      actorCounts.set(a, (actorCounts.get(a) ?? 0) + 1);
    }
  }

  const topDirectors = [...directorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topActors = [...actorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Build slug → posterPath lookup from shared-film enrichment so "Both Loved"
  // and "They Loved You Haven't Seen" render as a poster wall instead of text.
  const matchPosterBySlug = new Map<string, string>();
  for (const f of matchFilmDetails) {
    if (f.posterPath) matchPosterBySlug.set(f.slug, f.posterPath);
  }

  const isTasteMode = result.mode === "taste";

  if (
    !isTasteMode &&
    result.overlapCount === 0 &&
    (!result.sharedFilms || result.sharedFilms.length === 0)
  ) {
    return (
      <p className="text-muted text-sm">
        No shared rated films found with {result.username}. You need to have
        rated some of the same films for a comparison.
      </p>
    );
  }

  const scoreColor =
    result.score >= 70
      ? "text-accent"
      : result.score >= 40
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div className="space-y-4">
      {isTasteMode && result.breakdown ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className={`text-3xl font-bold ${scoreColor}`}>
                {result.score}%
              </div>
              <div className="text-muted text-xs mt-1">Taste Overlap</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{result.overlapCount}</div>
              <div className="text-muted text-xs mt-1">Both Watched</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {result.bothLoved?.length ?? 0}
              </div>
              <div className="text-muted text-xs mt-1">Both Loved</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {result.breakdown.likedOverlap}
              </div>
              <div className="text-muted text-xs mt-1">Like Similarity</div>
            </div>
          </div>
          <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-2 text-center">
            <p className="text-accent text-sm">
              Neither of you rates films — matching on what you watch and love
              instead.
            </p>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <div className={`text-3xl font-bold ${scoreColor}`}>
              {result.score}%
            </div>
            <div className="text-muted text-xs mt-1">Match Score</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{result.overlapCount}</div>
            <div className="text-muted text-xs mt-1">Shared Films</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{result.avgDifference}</div>
            <div className="text-muted text-xs mt-1">Avg Rating Diff</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{result.cosineSimilarity}</div>
            <div className="text-muted text-xs mt-1">Cosine Similarity</div>
          </div>
        </div>
      )}

      {(result.userTotal || result.friendTotal) && (
        <p className="text-muted text-xs text-center">
          Compared {result.userTotal ?? "?"} vs {result.friendTotal ?? "?"}{" "}
          rated films
        </p>
      )}

      {result.dataLimited && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-4 py-3 text-center">
          <p className="text-yellow-300 text-sm font-medium">
            Limited data — results based on ~50 most recent films per user
          </p>
          <p className="text-yellow-300/70 text-xs mt-1">
            Cloudflare blocked full scraping for one or both users. Try again
            in a few minutes for more accurate results.
          </p>
        </div>
      )}

      {/* Shared Most Watched Directors / Genres / Actors */}
      {(matchEnriching || matchFilmDetails.length > 0) && (
        <div>
          <h4 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
            What You Both Watch
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-background rounded-lg p-4">
              <h5 className="text-sm font-semibold mb-2">
                Most Watched Directors
              </h5>
              {topDirectors.length > 0 ? (
                <div>
                  {topDirectors.map(([name, count], i) => (
                    <LeaderboardItem
                      key={name}
                      rank={i + 1}
                      name={name}
                      count={count}
                    />
                  ))}
                </div>
              ) : (
                <EnrichingPlaceholder />
              )}
            </div>
            <div className="bg-background rounded-lg p-4">
              <h5 className="text-sm font-semibold mb-2">
                Most Watched Genres
              </h5>
              {topGenres.length > 0 ? (
                <div>
                  {topGenres.map(([name, count], i) => (
                    <LeaderboardItem
                      key={name}
                      rank={i + 1}
                      name={name}
                      count={count}
                    />
                  ))}
                </div>
              ) : (
                <EnrichingPlaceholder />
              )}
            </div>
            <div className="bg-background rounded-lg p-4">
              <h5 className="text-sm font-semibold mb-2">
                Most Watched Actors
              </h5>
              {topActors.length > 0 ? (
                <div>
                  {topActors.map(([name, count], i) => (
                    <LeaderboardItem
                      key={name}
                      rank={i + 1}
                      name={name}
                      count={count}
                    />
                  ))}
                </div>
              ) : (
                <EnrichingPlaceholder />
              )}
            </div>
          </div>
          {matchEnriching && (
            <p className="text-muted text-xs text-center mt-2">
              Analyzing shared films... {matchEnrichProgress}/
              {result.sharedSlugs?.length ?? 0}
            </p>
          )}
        </div>
      )}

      {/* Ratings mode: side-by-side rating comparison */}
      {!isTasteMode && result.sharedFilms && result.sharedFilms.length > 0 && (
        <div>
          <p className="text-sm text-muted mb-2">Shared Films:</p>
          <div className="space-y-1.5">
            {result.sharedFilms.map((film) => (
              <div
                key={film.title}
                className="flex items-center gap-3 text-sm"
              >
                <span className="flex-1 truncate">{film.title}</span>
                <span className="text-muted shrink-0">
                  You: <Stars rating={film.yourRating} />
                </span>
                <span className="text-muted shrink-0">
                  Them: <Stars rating={film.theirRating} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Taste mode: "Both loved" — strongest signal. Render as a poster wall
           once enrichment pulls TMDB posters; text-tile fallback otherwise. */}
      {isTasteMode && result.bothLoved && result.bothLoved.length > 0 && (
        <div>
          <p className="text-sm text-muted mb-3">
            &hearts; Films you both loved
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
            {result.bothLoved.slice(0, 16).map((slug) => (
              <a
                key={slug}
                href={`https://letterboxd.com/film/${slug}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1.5 group"
              >
                <Poster
                  posterPath={matchPosterBySlug.get(slug)}
                  title={slug.replace(/-/g, " ")}
                  size={92}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Taste mode: recommendations — films they love that you haven't seen. */}
      {isTasteMode &&
        result.theyLovedYouHavent &&
        result.theyLovedYouHavent.length > 0 && (
          <div>
            <p className="text-sm text-muted mb-3">
              &rarr; They loved, you haven&apos;t seen
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
              {result.theyLovedYouHavent.slice(0, 12).map((slug) => (
                <a
                  key={slug}
                  href={`https://letterboxd.com/film/${slug}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <Poster
                    posterPath={matchPosterBySlug.get(slug)}
                    title={slug.replace(/-/g, " ")}
                    size={92}
                  />
                </a>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
