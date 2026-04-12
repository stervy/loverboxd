"use client";

import { useState } from "react";

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
    source: "scraped" | "rss";
  };
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
      const resp = await fetch(`/api/stats?username=${encodeURIComponent(name)}`);
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
      <form onSubmit={handleSubmit} className="flex gap-3 max-w-md mx-auto mb-10">
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

function StatsView({ data, username }: { data: StatsData; username: string }) {
  const { profile, stats } = data;

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
              <p className="text-muted text-sm mt-1 max-w-lg">{profile.bio}</p>
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <StatCard label="Films" value={profile.filmsWatched} />
          <StatCard label="Following" value={profile.following} />
          <StatCard label="Followers" value={profile.followers} />
          <StatCard label="Lists" value={profile.listsCount} />
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
          Stats based on ~{stats.totalFilms} most recent diary entries via RSS.
          For complete stats, use the{" "}
          <a href="https://github.com/stervy/loverboxd" className="text-accent hover:text-accent-hover underline">CLI tool</a> with{" "}
          <code className="bg-background px-1 rounded">--full</code>.
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
              <div key={`${film.slug}-${i}`} className="flex items-center gap-3 py-1.5">
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
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
    </div>
  );
}
