"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { type CSVFilm, extractRatingsFromFile } from "./csv-utils";

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
}

interface MatchResult {
  username: string;
  overlapCount: number;
  avgDifference: number;
  cosineSimilarity: number;
  score: number;
  sharedFilms: {
    title: string;
    yourRating: number;
    theirRating: number;
    slug?: string;
  }[];
  sharedSlugs?: string[];
  userTotal?: number;
  friendTotal?: number;
  dataLimited?: boolean;
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

/* ---------- CSV → StatsData merge ---------- */

function mergeCSVIntoStats(
  films: CSVFilm[],
  original: StatsData
): StatsData {
  const rated = films.filter((f) => f.rating != null);
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

  // Merge CSV data when available
  const data = csvFilms ? mergeCSVIntoStats(csvFilms, originalData) : originalData;
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
          "No rated films found. Make sure this is your Letterboxd data export."
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
        // POST user's CSV films so the server doesn't need to scrape them
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

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            Upload your Letterboxd data export for stats across{" "}
            <em>all</em> your rated films.
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
            Have your Letterboxd data export? Upload it for guaranteed complete
            stats
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
            Loaded {csvFilms.length.toLocaleString()} rated films from your
            export
          </p>
        </div>
      )}

      {/* Rating Distribution */}
      {ratingEntries.length > 0 && (
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

      {/* Top Rated */}
      {stats.topRated.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Top Rated Films</h3>
          <div className="space-y-2">
            {stats.topRated.map((film, i) => (
              <div
                key={`${film.slug}-${i}`}
                className="flex items-center gap-3 py-1.5"
              >
                <span className="text-muted text-sm w-5 text-right">
                  {i + 1}
                </span>
                <Stars rating={film.rating!} />
                <a
                  href={`https://letterboxd.com/film/${film.slug}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  {film.title}
                </a>
                {film.year && (
                  <span className="text-muted text-sm">({film.year})</span>
                )}
              </div>
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
        <p className="text-muted text-sm mb-4">
          Compare your taste with another Letterboxd user based on shared
          ratings.
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

  // Enrich shared films with directors/genres/actors
  useEffect(() => {
    const slugs = result.sharedSlugs;
    if (!slugs || slugs.length === 0) return;

    let cancelled = false;
    async function enrich() {
      setMatchEnriching(true);
      setMatchEnrichProgress(0);
      const allDetails: FilmDetail[] = [];

      for (let i = 0; i < slugs!.length; i += 15) {
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
        setMatchEnrichProgress(Math.min(i + 15, slugs!.length));
      }

      setMatchEnriching(false);
    }

    enrich();
    return () => {
      cancelled = true;
    };
  }, [result.sharedSlugs]);

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

  if (result.overlapCount === 0) {
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

      {result.sharedFilms.length > 0 && (
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
    </div>
  );
}
