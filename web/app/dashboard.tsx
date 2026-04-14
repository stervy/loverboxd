"use client";

import { useState, useEffect, useCallback } from "react";

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
    source: "scraped" | "rss";
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
  sharedFilms: { title: string; yourRating: number; theirRating: number }[];
  userTotal?: number;
  friendTotal?: number;
}

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

function StatsView({
  data,
  username,
}: {
  data: StatsData;
  username: string;
}) {
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

  // Progressive enrichment: fetch film details in batches
  const enrichFilms = useCallback(async () => {
    const slugs = stats.allSlugs;
    if (!slugs || slugs.length === 0) return;

    setEnriching(true);
    setEnrichProgress(0);
    const allDetails: FilmDetail[] = [];

    for (let i = 0; i < slugs.length; i += 15) {
      const batch = slugs.slice(i, i + 15);
      try {
        const resp = await fetch("/api/film-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs: batch }),
        });
        if (resp.ok) {
          const json = await resp.json();
          allDetails.push(...(json.films ?? []));
          setFilmDetails([...allDetails]);
        }
      } catch {
        // Continue with what we have
      }
      setEnrichProgress(Math.min(i + 15, slugs.length));
    }

    setEnriching(false);
  }, [stats.allSlugs]);

  useEffect(() => {
    enrichFilms();
  }, [enrichFilms]);

  // Compute leaderboards from film details
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

  const topDirectors = [...directorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const topActors = [...actorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  async function handleMatch(e: React.FormEvent) {
    e.preventDefault();
    const friend = friendName.trim();
    if (!friend) return;

    setMatchLoading(true);
    setMatchError("");
    setMatchResult(null);

    try {
      const resp = await fetch(
        `/api/match?username=${encodeURIComponent(username)}&friend=${encodeURIComponent(friend)}`
      );
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

      {stats.source === "rss" && (
        <p className="text-muted text-xs text-center">
          Note: Stats may be limited due to Cloudflare restrictions. If
          numbers look low, try again in a moment.
        </p>
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

      {/* Top Directors / Genres / Actors */}
      {(enriching || filmDetails.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Top Directors</h3>
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
            <h3 className="text-lg font-semibold mb-4">Top Genres</h3>
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
            <h3 className="text-lg font-semibold mb-4">Top Actors</h3>
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

      {enriching && (
        <p className="text-muted text-xs text-center">
          Enriching film details... {enrichProgress}/{stats.allSlugs.length}{" "}
          films processed
        </p>
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

function MatchView({ result }: { result: MatchResult }) {
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
          Compared {result.userTotal ?? "?"} vs {result.friendTotal ?? "?"} rated films
        </p>
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

function EnrichingPlaceholder() {
  return (
    <div className="text-muted text-sm animate-pulse py-4 text-center">
      Loading...
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
