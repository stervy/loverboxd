"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import { type CSVFilm, extractRatingsFromFile } from "./csv-utils";
import { Chapter } from "./components/Chapter";
import { ChapterHero } from "./components/ChapterHero";
import { PosterRibbon } from "./components/PosterRibbon";
import { StickyNav } from "./components/StickyNav";
import { CHAPTERS, buildChapterContent } from "./lib/chapter-data";

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
  // Letterboxd-scraped fields used by the analytics sections. All optional
  // because older/obscure films may not have every value populated.
  themes?: string[];
  avgRating?: number;
  watchedCount?: number;
  likesCount?: number;
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
  href,
}: {
  rank: number;
  name: string;
  count: number;
  href?: string;
}) {
  const nameEl = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 hover:text-accent hover:underline truncate"
    >
      {name}
    </a>
  ) : (
    <span className="flex-1">{name}</span>
  );
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className="text-muted w-5 text-right">{rank}</span>
      {nameEl}
      <span className="text-muted text-xs">
        {count} film{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

/**
 * Slugify a person's name into Letterboxd's URL format. Matches the
 * conventions visible on letterboxd.com/actor/* and /director/*:
 * lowercase, ASCII-folded, non-alphanumerics collapsed to dashes.
 */
function letterboxdPersonUrl(
  role: "actor" | "director",
  name: string
): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://letterboxd.com/${role}/${slug}/`;
}

/**
 * Simple SVG pie chart + legend. Starts at the top and fills clockwise.
 * Handles the single-slice (full circle) edge case so Math.sin/cos don't
 * collapse to a zero-area path.
 */
function PieChart({
  data,
  size = 160,
}: {
  data: [string, number][];
  size?: number;
}) {
  const total = data.reduce((s, [, c]) => s + c, 0);
  if (total === 0 || data.length === 0) return null;

  // Distinct, legible palette that reads on both light and dark backgrounds.
  const palette = [
    "#f87171",
    "#fb923c",
    "#fbbf24",
    "#a3e635",
    "#34d399",
    "#22d3ee",
    "#60a5fa",
    "#a78bfa",
    "#f472b6",
    "#94a3b8",
  ];

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  // Prefix-sum fractions so we can compute each slice's start angle without
  // mutating shared state during render (React 19 flags that as unsafe).
  const fractions = data.map(([, c]) => c / total);
  const starts: number[] = [];
  fractions.reduce((acc, f) => {
    starts.push(acc);
    return acc + f;
  }, 0);

  const slices = data.map(([name, count], i) => {
    const frac = fractions[i];
    const a0 = -Math.PI / 2 + starts[i] * Math.PI * 2;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const d =
      data.length === 1
        ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
        : `M ${cx} ${cy} L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
    return { d, color: palette[i % palette.length], name, count, pct: frac };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
      >
        {slices.map((s) => (
          <path key={s.name} d={s.d} fill={s.color} />
        ))}
      </svg>
      <ul className="w-full grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 truncate" title={s.name}>
              {s.name}
            </span>
            <span className="text-muted tabular-nums shrink-0">
              {Math.round(s.pct * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Vertical bar chart with optional stacking (a "liked" subset of the total)
 * and an optional overlay line plotting a secondary value per bar. Hand-rolled
 * SVG to stay consistent with PieChart and avoid pulling in a charting lib.
 *
 * Data shape: each entry has a label (x-axis), total (primary bar height),
 * optional liked (stacked segment, drawn on top of total), and optional
 * overlay (secondary value plotted as a polyline — e.g. avg rating per theme).
 */
function BarChart({
  data,
  height = 200,
  overlayLabel,
  overlayRange,
  rotateLabels = false,
}: {
  data: { label: string; total: number; liked?: number; overlay?: number }[];
  height?: number;
  overlayLabel?: string;
  overlayRange?: [number, number];
  rotateLabels?: boolean;
}) {
  if (data.length === 0) return null;

  // Layout: SVG width is responsive via viewBox. We fix an arbitrary coordinate
  // width so bar widths stay visually balanced regardless of screen size.
  const barCount = data.length;
  const barWidth = 34;
  const gap = 10;
  const leftPad = 36;
  const rightPad = 36;
  const topPad = 16;
  const bottomPad = rotateLabels ? 70 : 34;
  const plotHeight = height - topPad - bottomPad;
  const width = leftPad + rightPad + barCount * (barWidth + gap) - gap;

  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const yBar = (v: number) => topPad + plotHeight * (1 - v / maxTotal);

  const hasOverlay = data.some((d) => d.overlay != null);
  const [ovLo, ovHi] = overlayRange ?? [
    Math.min(...data.map((d) => d.overlay ?? Infinity).filter((v) => Number.isFinite(v))),
    Math.max(...data.map((d) => d.overlay ?? -Infinity).filter((v) => Number.isFinite(v))),
  ];
  const ovSpan = Math.max(ovHi - ovLo, 0.0001);
  const yOverlay = (v: number) =>
    topPad + plotHeight * (1 - (v - ovLo) / ovSpan);

  const overlayPoints = hasOverlay
    ? data
        .map((d, i) => {
          if (d.overlay == null) return null;
          const x = leftPad + i * (barWidth + gap) + barWidth / 2;
          return `${x.toFixed(1)},${yOverlay(d.overlay).toFixed(1)}`;
        })
        .filter((p): p is string => p != null)
        .join(" ")
    : "";

  // Reference gridlines at 0/25/50/75/100% of the max total.
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: topPad + plotHeight * (1 - f),
    v: Math.round(maxTotal * f),
  }));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="overflow-visible"
      >
        {/* gridlines */}
        {gridYs.map(({ y, v }) => (
          <g key={y}>
            <line
              x1={leftPad}
              x2={width - rightPad}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-card-border"
              strokeWidth={0.5}
            />
            <text
              x={leftPad - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-muted text-[9px] tabular-nums"
            >
              {v}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = leftPad + i * (barWidth + gap);
          const notLiked = Math.max(d.total - (d.liked ?? 0), 0);
          const yNotLiked = yBar(notLiked);
          const yLiked = yBar(d.total);
          return (
            <g key={`${d.label}-${i}`}>
              {/* Base (not-liked) portion of the bar — green. */}
              <rect
                x={x}
                y={yNotLiked}
                width={barWidth}
                height={Math.max(plotHeight - (yNotLiked - topPad), 0)}
                fill="#34d399"
                opacity={0.85}
              />
              {/* Liked subset stacked on top — orange. */}
              {d.liked != null && d.liked > 0 && (
                <rect
                  x={x}
                  y={yLiked}
                  width={barWidth}
                  height={Math.max(yNotLiked - yLiked, 0)}
                  fill="#fb923c"
                />
              )}
              {/* Bar total label above the bar for legibility. */}
              <text
                x={x + barWidth / 2}
                y={yLiked - 4}
                textAnchor="middle"
                className="fill-muted text-[9px] tabular-nums"
              >
                {d.total}
              </text>
              {/* X-axis label — optionally rotated for long theme names. */}
              <text
                x={x + barWidth / 2}
                y={height - bottomPad + 12}
                textAnchor={rotateLabels ? "end" : "middle"}
                transform={
                  rotateLabels
                    ? `rotate(-55 ${x + barWidth / 2} ${height - bottomPad + 12})`
                    : undefined
                }
                className="fill-muted text-[10px]"
              >
                <title>{d.label}</title>
                {d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label}
              </text>
            </g>
          );
        })}

        {/* Overlay polyline (e.g. avg rating per theme). */}
        {hasOverlay && overlayPoints && (
          <>
            <polyline
              points={overlayPoints}
              fill="none"
              stroke="#60a5fa"
              strokeWidth={1.5}
            />
            {data.map((d, i) => {
              if (d.overlay == null) return null;
              const cx = leftPad + i * (barWidth + gap) + barWidth / 2;
              return (
                <circle
                  key={`ov-${i}`}
                  cx={cx}
                  cy={yOverlay(d.overlay)}
                  r={2.2}
                  fill="#60a5fa"
                />
              );
            })}
            {/* Right-side overlay axis — bottom / middle / top tick labels. */}
            {[ovLo, (ovLo + ovHi) / 2, ovHi].map((v, i) => (
              <text
                key={`ovtxt-${i}`}
                x={width - rightPad + 4}
                y={yOverlay(v) + 3}
                textAnchor="start"
                className="fill-[#60a5fa] text-[9px] tabular-nums"
              >
                {v.toFixed(1)}
              </text>
            ))}
          </>
        )}
      </svg>

      {/* Legend. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted mt-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#34d399]" />
          watched
        </span>
        {data.some((d) => (d.liked ?? 0) > 0) && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#fb923c]" />
            liked
          </span>
        )}
        {hasOverlay && overlayLabel && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-[#60a5fa]" />
            {overlayLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Person leaderboard with headshots for the top 3 and a compact ranked list
 * for the rest. Falls back to initials via Avatar when TMDB has no photo or
 * the lookup hasn't resolved yet.
 */
function PersonLeaderboard({
  items,
  peopleMap,
  role,
}: {
  items: [string, number][];
  peopleMap: Map<string, PersonInfo>;
  role: "actor" | "director";
}) {
  const top3 = items.slice(0, 3);
  const rest = items.slice(3);
  return (
    <div>
      {top3.length > 0 && (
        <div className="flex items-start justify-around gap-2 mb-3">
          {top3.map(([name, count]) => (
            <a
              key={name}
              href={letterboxdPersonUrl(role, name)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 text-center min-w-0 flex-1 group hover:opacity-90 transition-opacity"
              title={`View ${name} on Letterboxd`}
            >
              <Avatar
                profilePath={peopleMap.get(name)?.profilePath}
                name={name}
                size={64}
              />
              <div className="text-xs font-medium truncate w-full group-hover:text-accent group-hover:underline">
                {name}
              </div>
              <div className="text-muted text-[11px]">
                {count} film{count !== 1 ? "s" : ""}
              </div>
            </a>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div>
          {rest.map(([name, count], i) => (
            <LeaderboardItem
              key={name}
              rank={i + 4}
              name={name}
              count={count}
              href={letterboxdPersonUrl(role, name)}
            />
          ))}
        </div>
      )}
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

/**
 * Circular TMDB profile avatar for a person (director/actor). Falls back to
 * the person's initials on a neutral slate when TMDB has no profile photo
 * or the lookup hasn't resolved yet.
 */
function Avatar({
  profilePath,
  name,
  size = 40,
}: {
  profilePath?: string;
  name: string;
  size?: number;
}) {
  const url = profilePath
    ? `https://image.tmdb.org/t/p/w185${profilePath}`
    : null;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover bg-card-border"
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  return (
    <div
      className="rounded-full bg-card-border text-muted flex items-center justify-center font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
      title={name}
    >
      {initials}
    </div>
  );
}

/**
 * Resolve a set of person names (directors / actors) to TMDB profiles via
 * /api/person-lookup. Returns a Map so the calling component can render
 * avatars by name. Names are deduplicated and the lookup is skipped when
 * the list is empty. Results update as soon as the single batched request
 * returns — no progressive updates since the whole batch is small (< 30).
 */
interface PersonInfo {
  profilePath?: string;
  tmdbId: number;
}

function usePersonLookup(
  names: string[],
  role?: "director" | "actor"
): Map<string, PersonInfo> {
  const [map, setMap] = useState<Map<string, PersonInfo>>(new Map());

  // Stable key that changes only when the set of names changes. Using a
  // joined string lets us pass a raw string into the dep array instead of
  // an array reference that'd re-trigger every render.
  const key = useMemo(() => {
    return [...new Set(names.filter(Boolean))].sort().join("|");
  }, [names]);

  useEffect(() => {
    const uniqueNames = key.split("|").filter(Boolean);
    if (uniqueNames.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/person-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: uniqueNames, role }),
        });
        if (!resp.ok || cancelled) return;
        const json = (await resp.json()) as {
          people?: Record<
            string,
            { profilePath?: string; tmdbId: number }
          >;
        };
        if (cancelled) return;
        const next = new Map<string, PersonInfo>();
        for (const [name, hit] of Object.entries(json.people ?? {})) {
          next.set(name, { profilePath: hit.profilePath, tmdbId: hit.tmdbId });
        }
        setMap(next);
      } catch {
        // Silent — avatars just stay as initials.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, role]);

  return map;
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

  // Which Power Duo row is expanded to show its film list (null = none).
  // Keyed by "director|||actor" so it stays stable if the list reorders.
  const [expandedDuoKey, setExpandedDuoKey] = useState<string | null>(null);

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

  // Build slug → title lookup. Prefers CSV titles (most complete), falls back
  // to topRated; renders fall back to a humanized slug when no title is known.
  const titleBySlug = useMemo(() => {
    const map = new Map<string, string>();
    if (csvFilms) {
      for (const f of csvFilms) {
        if (f.slug && f.title) map.set(f.slug, f.title);
      }
    }
    for (const f of stats.topRated) {
      if (f.slug && f.title && !map.has(f.slug)) map.set(f.slug, f.title);
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
    const pairSlugs = new Map<string, string[]>();
    for (const film of filmDetails) {
      for (const dir of film.directors) {
        for (const act of film.actors) {
          // Skip self-pairs (same person credited as both director and actor
          // on the same film) — "Tarantino + Tarantino" isn't a duo.
          if (dir === act) continue;
          const key = `${dir}|||${act}`;
          const existing = pairSlugs.get(key);
          if (existing) existing.push(film.slug);
          else pairSlugs.set(key, [film.slug]);
        }
      }
    }
    return [...pairSlugs.entries()]
      .filter(([, slugs]) => slugs.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([key, slugs]) => {
        const [director, actor] = key.split("|||");
        return { director, actor, count: slugs.length, slugs };
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

  // Derive content (subtitle + mural poster paths) for each chapter hero.
  // Pulls from already-computed stats and filmDetails, so no new data work.
  const chapterContent = useMemo(() => {
    const posterBySlug = new Map<string, string>();
    for (const f of filmDetails) {
      if (f.posterPath) posterBySlug.set(f.slug, f.posterPath);
    }

    const fiveStarPosters: string[] = [];
    for (const [slug, rating] of ratingBySlug) {
      if (rating >= 5) {
        const p = posterBySlug.get(slug);
        if (p) fiveStarPosters.push(p);
      }
    }

    const ratings = [...ratingBySlug.values()].sort((a, b) => a - b);
    const p25Stars = ratings.length ? ratings[Math.floor(ratings.length * 0.25)] : 0;
    const p75Stars = ratings.length ? ratings[Math.floor(ratings.length * 0.75)] : 0;

    // topDirectors / topGenres are tuple arrays: [name, count][].
    const topDirectorName = topDirectors[0]?.[0] ?? null;
    const topDirectorFilmCount = topDirectors[0]?.[1] ?? 0;
    const topDirectorPosters: string[] = [];
    if (topDirectorName) {
      for (const f of filmDetails) {
        if (f.directors.includes(topDirectorName) && f.posterPath) {
          topDirectorPosters.push(f.posterPath);
        }
      }
    }

    const topGenreName = topGenres[0]?.[0] ?? null;
    const topGenreCount = topGenres[0]?.[1] ?? 0;
    const totalGenreCount = topGenres.reduce((sum, g) => sum + g[1], 0);
    const topGenrePercent = totalGenreCount > 0 ? Math.round((topGenreCount / totalGenreCount) * 100) : 0;
    const topGenrePosters: string[] = [];
    if (topGenreName) {
      for (const f of filmDetails) {
        if (f.genres.includes(topGenreName) && f.posterPath) {
          topGenrePosters.push(f.posterPath);
        }
      }
    }

    let totalMinutes = 0;
    let longestFilmPoster: string | null = null;
    let longestFilmRuntime = 0;
    const countries = new Set<string>();
    for (const f of filmDetails) {
      if (typeof f.runtime === "number") totalMinutes += f.runtime;
      for (const c of f.countries ?? []) countries.add(c);
      if ((f.runtime ?? 0) > longestFilmRuntime && f.posterPath) {
        longestFilmRuntime = f.runtime ?? 0;
        longestFilmPoster = f.posterPath;
      }
    }
    const hoursWatched = Math.round(totalMinutes / 60);

    const topRatedPosters: string[] = [];
    for (const tr of stats.topRated ?? []) {
      const p = posterBySlug.get(tr.slug);
      if (p) topRatedPosters.push(p);
    }

    return buildChapterContent({
      totalRated: ratingBySlug.size,
      p25Stars,
      p75Stars,
      topDirectorName,
      topDirectorFilmCount,
      topGenreName,
      topGenrePercent,
      hoursWatched,
      countryCount: countries.size,
      topRatedCount: Math.min(10, topRatedPosters.length),
      recentCount: (stats.recentActivity ?? []).length,
      fiveStarPosters,
      topDirectorPosters,
      topGenrePosters,
      longestFilmPoster,
      topRatedPosters,
    });
  }, [filmDetails, ratingBySlug, topDirectors, topGenres, stats.topRated, stats.recentActivity]);

  // 4-star posters for Ch 1 ribbon (between Rating Distribution and Popularity).
  const fourStarPosters = useMemo(() => {
    const posterBySlug = new Map<string, string>();
    for (const f of filmDetails) {
      if (f.posterPath) posterBySlug.set(f.slug, f.posterPath);
    }
    const out: string[] = [];
    for (const [slug, rating] of ratingBySlug) {
      if (rating >= 4 && rating < 5) {
        const p = posterBySlug.get(slug);
        if (p) out.push(p);
      }
    }
    return out.slice(0, 5);
  }, [filmDetails, ratingBySlug]);

  // Highest-rated directors & actors — Bayesian-shrunk avg rating per person.
  //
  // Raw avg rating heavily favors one-hit wonders (one 5★ film = perfect
  // score). We shrink each person's avg toward the user's global mean using
  // (sum + m * globalMean) / (count + m). With m = 3, someone with a single
  // 5★ film only ranks as well as a person with 3+ films averaging slightly
  // above the user's baseline. People with more films at a high avg float to
  // the top — which is the genuinely interesting signal.
  //
  // Also require count >= 2 as a floor so single-film entries don't appear
  // at all. Displayed avg is the raw avg (intuitive); the Bayesian value is
  // only used for ranking.
  const highestRatedPeople = useMemo(() => {
    if (ratingBySlug.size === 0) return null;
    let globalSum = 0;
    for (const r of ratingBySlug.values()) globalSum += r;
    const globalMean = globalSum / ratingBySlug.size;
    const M_DIRECTOR = 3;
    const M_ACTOR = 3;

    const dirStats = new Map<string, { sum: number; count: number }>();
    const actStats = new Map<string, { sum: number; count: number }>();
    for (const film of filmDetails) {
      const rating = ratingBySlug.get(film.slug);
      if (rating == null) continue;
      for (const d of film.directors) {
        const e = dirStats.get(d) ?? { sum: 0, count: 0 };
        e.sum += rating;
        e.count += 1;
        dirStats.set(d, e);
      }
      for (const a of film.actors) {
        const e = actStats.get(a) ?? { sum: 0, count: 0 };
        e.sum += rating;
        e.count += 1;
        actStats.set(a, e);
      }
    }

    const rank = (
      stats: Map<string, { sum: number; count: number }>,
      m: number
    ) =>
      [...stats.entries()]
        .filter(([, v]) => v.count >= 2)
        .map(([name, v]) => ({
          name,
          avg: v.sum / v.count,
          count: v.count,
          score: (v.sum + m * globalMean) / (v.count + m),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    const directors = rank(dirStats, M_DIRECTOR);
    const actors = rank(actStats, M_ACTOR);
    if (directors.length === 0 && actors.length === 0) return null;
    return { directors, actors, globalMean };
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

  // Liked-slug set — which films the user hearted. Only available when they
  // uploaded the ZIP (likes/films.csv). Used to stack the orange "liked"
  // segment on the new bar charts. Empty for RSS-only users.
  const likedSlugSet = useMemo(() => {
    const s = new Set<string>();
    if (csvFilms) {
      for (const f of csvFilms) if (f.liked && f.slug) s.add(f.slug);
    }
    return s;
  }, [csvFilms]);

  // 7. Top Genre Combinations — pairs of genres that co-occur on the same film.
  // For each film with ≥2 genres we emit every alphabetically-sorted pair so
  // "Drama + Romance" and "Romance + Drama" collapse to one key.
  const topGenreCombinations = useMemo(() => {
    const counts = new Map<string, { total: number; liked: number }>();
    for (const film of filmDetails) {
      if (!film.genres || film.genres.length < 2) continue;
      const sorted = [...film.genres].sort();
      const isLiked = likedSlugSet.has(film.slug) ? 1 : 0;
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]} + ${sorted[j]}`;
          const entry = counts.get(key) ?? { total: 0, liked: 0 };
          entry.total += 1;
          entry.liked += isLiked;
          counts.set(key, entry);
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([label, { total, liked }]) => ({ label, total, liked }));
  }, [filmDetails, likedSlugSet]);

  // 8. Top Themes — Letterboxd theme/nanogenre tags, with the user's avg
  // rating in each theme overlaid as a line. avgUserRating is only meaningful
  // when the user rates films, so we compute it conditionally.
  const topThemes = useMemo(() => {
    const stats = new Map<
      string,
      { total: number; liked: number; ratingSum: number; ratingCount: number }
    >();
    for (const film of filmDetails) {
      if (!film.themes || film.themes.length === 0) continue;
      const isLiked = likedSlugSet.has(film.slug) ? 1 : 0;
      const userRating = ratingBySlug.get(film.slug);
      for (const t of film.themes) {
        const entry =
          stats.get(t) ?? { total: 0, liked: 0, ratingSum: 0, ratingCount: 0 };
        entry.total += 1;
        entry.liked += isLiked;
        if (userRating != null) {
          entry.ratingSum += userRating;
          entry.ratingCount += 1;
        }
        stats.set(t, entry);
      }
    }
    const sorted = [...stats.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20);
    if (sorted.length === 0) return [];
    return sorted.map(([label, s]) => ({
      label,
      total: s.total,
      liked: s.liked,
      avgUserRating: s.ratingCount > 0 ? s.ratingSum / s.ratingCount : undefined,
    }));
  }, [filmDetails, likedSlugSet, ratingBySlug]);

  // 9. Popularity & Likeability buckets — how obscure / likeable are this
  // user's films on average, compared to the Letterboxd universe. Popularity
  // is measured by watchedCount; likeability by likesCount / watchedCount.
  // Thresholds match the reference screenshots so bucket labels stay familiar.
  const popularityBuckets = useMemo(() => {
    const buckets: { label: string; total: number; liked: number }[] = [
      { label: "very obscure", total: 0, liked: 0 },
      { label: "obscure", total: 0, liked: 0 },
      { label: "popular", total: 0, liked: 0 },
      { label: "very popular", total: 0, liked: 0 },
    ];
    let filmsWithData = 0;
    for (const film of filmDetails) {
      if (film.watchedCount == null) continue;
      filmsWithData += 1;
      const idx =
        film.watchedCount <= 10_000
          ? 0
          : film.watchedCount <= 100_000
            ? 1
            : film.watchedCount <= 1_000_000
              ? 2
              : 3;
      buckets[idx].total += 1;
      if (likedSlugSet.has(film.slug)) buckets[idx].liked += 1;
    }
    return filmsWithData === 0 ? null : buckets;
  }, [filmDetails, likedSlugSet]);

  const likeabilityBuckets = useMemo(() => {
    const buckets: { label: string; total: number; liked: number }[] = [
      { label: "rarely likeable", total: 0, liked: 0 },
      { label: "sometimes likeable", total: 0, liked: 0 },
      { label: "often likeable", total: 0, liked: 0 },
      { label: "usually likeable", total: 0, liked: 0 },
    ];
    let filmsWithData = 0;
    for (const film of filmDetails) {
      if (
        film.likesCount == null ||
        film.watchedCount == null ||
        film.watchedCount === 0
      ) {
        continue;
      }
      filmsWithData += 1;
      const ratio = film.likesCount / film.watchedCount;
      const idx =
        ratio <= 0.1 ? 0 : ratio <= 0.2 ? 1 : ratio <= 0.4 ? 2 : 3;
      buckets[idx].total += 1;
      if (likedSlugSet.has(film.slug)) buckets[idx].liked += 1;
    }
    return filmsWithData === 0 ? null : buckets;
  }, [filmDetails, likedSlugSet]);

  // Extremes (most obscure / most popular / most likeable / least likeable)
  // used for the prose callouts under the popularity & likeability charts.
  const popularityExtremes = useMemo(() => {
    let mostObscure: FilmDetail | null = null;
    let mostPopular: FilmDetail | null = null;
    let mostLikeable: { film: FilmDetail; ratio: number } | null = null;
    let leastLikeable: { film: FilmDetail; ratio: number } | null = null;
    for (const film of filmDetails) {
      if (film.watchedCount != null) {
        if (mostObscure == null || film.watchedCount < mostObscure.watchedCount!) {
          mostObscure = film;
        }
        if (mostPopular == null || film.watchedCount > mostPopular.watchedCount!) {
          mostPopular = film;
        }
        if (film.likesCount != null && film.watchedCount > 0) {
          const ratio = film.likesCount / film.watchedCount;
          if (mostLikeable == null || ratio > mostLikeable.ratio) {
            mostLikeable = { film, ratio };
          }
          if (leastLikeable == null || ratio < leastLikeable.ratio) {
            leastLikeable = { film, ratio };
          }
        }
      }
    }
    return { mostObscure, mostPopular, mostLikeable, leastLikeable };
  }, [filmDetails]);

  // 10. Rating comparison — side-by-side histograms of the user's ratings vs
  // the Letterboxd weighted averages for the same films, plus the headline
  // delta + biggest disagreements for the prose copy. Gated on the user
  // having rated at least one film (proxy for hasRatings, since hasRatings
  // is declared later in the component body).
  const ratingComparison = useMemo(() => {
    if (ratingBySlug.size === 0) return null;

    // User rating histogram in half-star bins (0.5 → 5.0).
    const userBins: { label: string; total: number; liked: number }[] = [];
    for (let r = 0.5; r <= 5.0001; r += 0.5) {
      userBins.push({ label: r.toFixed(1), total: 0, liked: 0 });
    }
    for (const [slug, rating] of ratingBySlug) {
      const idx = Math.round(rating / 0.5) - 1;
      if (idx >= 0 && idx < userBins.length) {
        userBins[idx].total += 1;
        if (likedSlugSet.has(slug)) userBins[idx].liked += 1;
      }
    }

    // Average-rating histogram in half-star bins, restricted to films the user
    // rated (so both histograms cover the same denominator of films).
    const avgBins: { label: string; total: number; liked: number }[] = [];
    for (let r = 0.5; r <= 5.0001; r += 0.5) {
      avgBins.push({ label: r.toFixed(1), total: 0, liked: 0 });
    }
    let totalDelta = 0;
    let deltaCount = 0;
    let biggest: {
      slug: string;
      userRating: number;
      avgRating: number;
      diff: number;
    } | null = null;
    const underRated: {
      slug: string;
      userRating: number;
      avgRating: number;
      diff: number;
    }[] = [];
    const overRated: {
      slug: string;
      userRating: number;
      avgRating: number;
      diff: number;
    }[] = [];
    let lowestAvg: { slug: string; avg: number } | null = null;
    let highestAvg: { slug: string; avg: number } | null = null;

    for (const film of filmDetails) {
      const userRating = ratingBySlug.get(film.slug);
      if (userRating == null || film.avgRating == null) continue;
      const binIdx = Math.min(
        Math.max(Math.round(film.avgRating / 0.5) - 1, 0),
        avgBins.length - 1
      );
      avgBins[binIdx].total += 1;
      if (likedSlugSet.has(film.slug)) avgBins[binIdx].liked += 1;

      const diff = userRating - film.avgRating;
      totalDelta += diff;
      deltaCount += 1;
      if (biggest == null || Math.abs(diff) > Math.abs(biggest.diff)) {
        biggest = { slug: film.slug, userRating, avgRating: film.avgRating, diff };
      }
      if (diff < 0) {
        overRated.push({
          slug: film.slug,
          userRating,
          avgRating: film.avgRating,
          diff,
        });
      } else if (diff > 0) {
        underRated.push({
          slug: film.slug,
          userRating,
          avgRating: film.avgRating,
          diff,
        });
      }
      if (lowestAvg == null || film.avgRating < lowestAvg.avg) {
        lowestAvg = { slug: film.slug, avg: film.avgRating };
      }
      if (highestAvg == null || film.avgRating > highestAvg.avg) {
        highestAvg = { slug: film.slug, avg: film.avgRating };
      }
    }

    if (deltaCount === 0) return null;

    underRated.sort((a, b) => b.diff - a.diff);
    overRated.sort((a, b) => a.diff - b.diff);

    return {
      userBins,
      avgBins,
      avgDelta: totalDelta / deltaCount,
      biggest,
      underRated: underRated.slice(0, 10),
      overRated: overRated.slice(0, 10),
      lowestAvg,
      highestAvg,
    };
  }, [filmDetails, ratingBySlug, likedSlugSet]);

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

  // Collect every person name that appears in the three avatar-enabled cards
  // (Power Duos, 5-Star Club, Liked Films Club) and look them all up in a
  // single request. Bounded to at most ~18 unique names — cheap and cached.
  const peopleToLookup = useMemo(() => {
    const names = new Set<string>();
    for (const d of powerDuos) {
      names.add(d.director);
      names.add(d.actor);
    }
    for (const [n] of topDirectors) names.add(n);
    for (const [n] of topActors) names.add(n);
    if (highestRatedPeople) {
      for (const p of highestRatedPeople.directors) names.add(p.name);
      for (const p of highestRatedPeople.actors) names.add(p.name);
    }
    if (fiveStarClub) {
      for (const [n] of fiveStarClub.topDirectors) names.add(n);
      for (const [n] of fiveStarClub.topActors) names.add(n);
    }
    if (likedFilmsClub) {
      for (const [n] of likedFilmsClub.topDirectors) names.add(n);
      for (const [n] of likedFilmsClub.topActors) names.add(n);
    }
    return [...names];
  }, [powerDuos, topDirectors, topActors, highestRatedPeople, fiveStarClub, likedFilmsClub]);

  const peopleMap = usePersonLookup(peopleToLookup);

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
              <PersonLeaderboard
                items={topDirectors}
                peopleMap={peopleMap}
                role="director"
              />
            ) : (
              <EnrichingPlaceholder />
            )}
          </div>

          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">
              Most Watched Genres
            </h3>
            {topGenres.length > 0 ? (
              <PieChart data={topGenres} />
            ) : (
              <EnrichingPlaceholder />
            )}
          </div>

          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">
              Most Watched Actors
            </h3>
            {topActors.length > 0 ? (
              <PersonLeaderboard
                items={topActors}
                peopleMap={peopleMap}
                role="actor"
              />
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
          {/* Top Genre Combinations — pairs of genres that co-occur on the
               same film. Derived from existing genres data, no extra scrape. */}
          {topGenreCombinations.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-1">
                Top Genre Combinations
              </h3>
              <p className="text-muted text-xs mb-4">
                Pairs of genres that keep showing up together in your films.
              </p>
              <BarChart
                data={topGenreCombinations}
                height={220}
                rotateLabels
              />
              <p className="text-muted text-sm mt-3">
                Your most frequent combination is{" "}
                <span className="text-foreground font-medium">
                  {topGenreCombinations[0].label}
                </span>{" "}
                with{" "}
                <span className="text-foreground font-medium">
                  {topGenreCombinations[0].total}
                </span>{" "}
                films.
              </p>
            </div>
          )}

          {/* Top Themes — Letterboxd-tagged themes & nanogenres with an
               overlay line for the user's avg rating in each theme (when we
               have ratings). Gated on any themes being scraped. */}
          {topThemes.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-1">Top Themes</h3>
              <p className="text-muted text-xs mb-4">
                What your films are actually about — from Letterboxd&apos;s
                theme &amp; nanogenre tags.
              </p>
              <BarChart
                data={topThemes.map((t) => ({
                  label: t.label,
                  total: t.total,
                  liked: t.liked,
                  overlay: t.avgUserRating,
                }))}
                height={260}
                rotateLabels
                overlayLabel="your avg rating"
                overlayRange={[0.5, 5]}
              />
              {(() => {
                // Best/worst themes by avg user rating (min 3 films so single
                // outliers don't hijack the callouts).
                const rated = topThemes.filter(
                  (t) => t.avgUserRating != null && t.total >= 3
                );
                if (rated.length === 0) {
                  return (
                    <p className="text-muted text-sm mt-3">
                      Your most-watched theme is{" "}
                      <span className="text-foreground font-medium">
                        {topThemes[0].label}
                      </span>{" "}
                      ({topThemes[0].total} films).
                    </p>
                  );
                }
                const best = [...rated].sort(
                  (a, b) => (b.avgUserRating ?? 0) - (a.avgUserRating ?? 0)
                )[0];
                const worst = [...rated].sort(
                  (a, b) => (a.avgUserRating ?? 0) - (b.avgUserRating ?? 0)
                )[0];
                return (
                  <p className="text-muted text-sm mt-3">
                    Your most-watched theme is{" "}
                    <span className="text-foreground font-medium">
                      {topThemes[0].label}
                    </span>
                    . You rated{" "}
                    <span className="text-foreground font-medium">
                      {best.label}
                    </span>{" "}
                    highest (avg {best.avgUserRating?.toFixed(2)}) and{" "}
                    <span className="text-foreground font-medium">
                      {worst.label}
                    </span>{" "}
                    lowest (avg {worst.avgUserRating?.toFixed(2)}).
                  </p>
                );
              })()}
            </div>
          )}

          {/* Popularity + Likeability — side-by-side bucket charts showing
               how obscure / how widely-liked the user's films are on
               Letterboxd. Both gated independently on stats data. */}
          {(popularityBuckets || likeabilityBuckets) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {popularityBuckets && (
                <div className="bg-card border border-card-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-1">
                    How Popular are Your Movies?
                  </h3>
                  <p className="text-muted text-xs mb-4">
                    Classified by Letterboxd watch count.
                  </p>
                  <BarChart data={popularityBuckets} height={200} />
                  <p className="text-muted text-sm mt-3">
                    {popularityExtremes.mostObscure && (
                      <>
                        Your most obscure film is{" "}
                        <a
                          href={`https://letterboxd.com/film/${popularityExtremes.mostObscure.slug}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground font-medium hover:text-accent"
                        >
                          {titleBySlug.get(popularityExtremes.mostObscure.slug) ??
                            popularityExtremes.mostObscure.slug.replace(/-/g, " ")}
                        </a>{" "}
                        ({popularityExtremes.mostObscure.watchedCount?.toLocaleString()}{" "}
                        watchers).
                      </>
                    )}
                    {popularityExtremes.mostPopular && (
                      <>
                        {" "}Most popular is{" "}
                        <a
                          href={`https://letterboxd.com/film/${popularityExtremes.mostPopular.slug}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground font-medium hover:text-accent"
                        >
                          {titleBySlug.get(popularityExtremes.mostPopular.slug) ??
                            popularityExtremes.mostPopular.slug.replace(/-/g, " ")}
                        </a>{" "}
                        ({popularityExtremes.mostPopular.watchedCount?.toLocaleString()}).
                      </>
                    )}
                  </p>
                  <details className="mt-3 text-xs text-muted">
                    <summary className="cursor-pointer hover:text-foreground">
                      Popularity classification
                    </summary>
                    <ul className="mt-2 space-y-0.5 pl-3">
                      <li>≤ 10,000 → very obscure</li>
                      <li>10,001 – 100,000 → obscure</li>
                      <li>100,001 – 1,000,000 → popular</li>
                      <li>&gt; 1,000,000 → very popular</li>
                    </ul>
                  </details>
                </div>
              )}
              {likeabilityBuckets && (
                <div className="bg-card border border-card-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-1">
                    How Likeable are Your Movies?
                  </h3>
                  <p className="text-muted text-xs mb-4">
                    Based on Letterboxd&apos;s like-to-watch ratio.
                  </p>
                  <BarChart data={likeabilityBuckets} height={200} />
                  <p className="text-muted text-sm mt-3">
                    {popularityExtremes.mostLikeable && (
                      <>
                        Your most likeable film is{" "}
                        <a
                          href={`https://letterboxd.com/film/${popularityExtremes.mostLikeable.film.slug}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground font-medium hover:text-accent"
                        >
                          {titleBySlug.get(popularityExtremes.mostLikeable.film.slug) ??
                            popularityExtremes.mostLikeable.film.slug.replace(/-/g, " ")}
                        </a>{" "}
                        ({(popularityExtremes.mostLikeable.ratio * 100).toFixed(1)}%
                        liked).
                      </>
                    )}
                    {popularityExtremes.leastLikeable && (
                      <>
                        {" "}Least likeable is{" "}
                        <a
                          href={`https://letterboxd.com/film/${popularityExtremes.leastLikeable.film.slug}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground font-medium hover:text-accent"
                        >
                          {titleBySlug.get(popularityExtremes.leastLikeable.film.slug) ??
                            popularityExtremes.leastLikeable.film.slug.replace(/-/g, " ")}
                        </a>{" "}
                        ({(popularityExtremes.leastLikeable.ratio * 100).toFixed(1)}%).
                      </>
                    )}
                  </p>
                  <details className="mt-3 text-xs text-muted">
                    <summary className="cursor-pointer hover:text-foreground">
                      Likeability classification
                    </summary>
                    <ul className="mt-2 space-y-0.5 pl-3">
                      <li>≤ 0.1 → rarely likeable</li>
                      <li>0.1 – 0.2 → sometimes likeable</li>
                      <li>0.2 – 0.4 → often likeable</li>
                      <li>&gt; 0.4 → usually likeable</li>
                    </ul>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* Rating comparison — user's histogram vs Letterboxd averages for
               the same films. Gated on hasRatings so rating-free users don't
               see empty charts. */}
          {hasRatings && ratingComparison && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-1">
                  How Do You Rate Your Movies?
                </h3>
                <p className="text-muted text-xs mb-4">
                  Your own star-rating distribution.
                </p>
                <BarChart data={ratingComparison.userBins} height={200} />
                <p className="text-muted text-sm mt-3">
                  On average you rate films{" "}
                  <span className="text-foreground font-medium">
                    {ratingComparison.avgDelta >= 0 ? "higher" : "lower"}
                  </span>{" "}
                  than the average Letterboxd user, by{" "}
                  <span className="text-foreground font-medium">
                    {Math.abs(ratingComparison.avgDelta).toFixed(2)}
                  </span>{" "}
                  points.
                  {ratingComparison.biggest && (
                    <>
                      {" "}You differed most on{" "}
                      <a
                        href={`https://letterboxd.com/film/${ratingComparison.biggest.slug}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground font-medium hover:text-accent"
                      >
                        {titleBySlug.get(ratingComparison.biggest.slug) ??
                          ratingComparison.biggest.slug.replace(/-/g, " ")}
                      </a>{" "}
                      — you rated{" "}
                      {ratingComparison.biggest.userRating.toFixed(1)} vs the
                      crowd&apos;s{" "}
                      {ratingComparison.biggest.avgRating.toFixed(2)}.
                    </>
                  )}
                </p>
                {ratingComparison.underRated.length > 0 && (
                  <details className="mt-3 text-xs text-muted">
                    <summary className="cursor-pointer hover:text-foreground">
                      Movies You Under Rated
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {ratingComparison.overRated.map((f) => (
                        <li key={f.slug} className="flex justify-between gap-2">
                          <a
                            href={`https://letterboxd.com/film/${f.slug}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate hover:text-foreground"
                          >
                            {titleBySlug.get(f.slug) ?? f.slug.replace(/-/g, " ")}
                          </a>
                          <span className="tabular-nums shrink-0">
                            {f.userRating.toFixed(1)} vs {f.avgRating.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {ratingComparison.overRated.length > 0 && (
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer hover:text-foreground">
                      Movies You Over Rated
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {ratingComparison.underRated.map((f) => (
                        <li key={f.slug} className="flex justify-between gap-2">
                          <a
                            href={`https://letterboxd.com/film/${f.slug}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate hover:text-foreground"
                          >
                            {titleBySlug.get(f.slug) ?? f.slug.replace(/-/g, " ")}
                          </a>
                          <span className="tabular-nums shrink-0">
                            {f.userRating.toFixed(1)} vs {f.avgRating.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-1">
                  How Do Letterboxd Users Rate Your Movies?
                </h3>
                <p className="text-muted text-xs mb-4">
                  Average ratings from the crowd for the same films.
                </p>
                <BarChart data={ratingComparison.avgBins} height={200} />
                <p className="text-muted text-sm mt-3">
                  {ratingComparison.lowestAvg && (
                    <>
                      Lowest crowd-rated film:{" "}
                      <a
                        href={`https://letterboxd.com/film/${ratingComparison.lowestAvg.slug}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground font-medium hover:text-accent"
                      >
                        {titleBySlug.get(ratingComparison.lowestAvg.slug) ??
                          ratingComparison.lowestAvg.slug.replace(/-/g, " ")}
                      </a>{" "}
                      ({ratingComparison.lowestAvg.avg.toFixed(2)}).
                    </>
                  )}
                  {ratingComparison.highestAvg && (
                    <>
                      {" "}Highest:{" "}
                      <a
                        href={`https://letterboxd.com/film/${ratingComparison.highestAvg.slug}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground font-medium hover:text-accent"
                      >
                        {titleBySlug.get(ratingComparison.highestAvg.slug) ??
                          ratingComparison.highestAvg.slug.replace(/-/g, " ")}
                      </a>{" "}
                      ({ratingComparison.highestAvg.avg.toFixed(2)}).
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

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

            {/* Director-Actor Power Duos — with TMDB headshots that fade in
                 as the person lookup resolves. Falls back to initials when
                 TMDB has no profile photo. */}
            {powerDuos.length > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">Power Duos</h3>
                <div className="space-y-4">
                  {powerDuos.map(({ director, actor, count, slugs }, i) => {
                    const key = `${director}|||${actor}`;
                    const isExpanded = expandedDuoKey === key;
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedDuoKey(isExpanded ? null : key)
                          }
                          aria-expanded={isExpanded}
                          className="w-full flex items-center gap-3 text-left rounded-lg -mx-2 px-2 py-1 hover:bg-background/60 transition-colors cursor-pointer"
                        >
                          <span className="text-accent font-bold text-lg w-4">
                            {i + 1}
                          </span>
                          <div className="flex -space-x-2 shrink-0">
                            <Avatar
                              name={director}
                              profilePath={peopleMap.get(director)?.profilePath}
                              size={44}
                            />
                            <Avatar
                              name={actor}
                              profilePath={peopleMap.get(actor)?.profilePath}
                              size={44}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {director} <span className="text-muted">+</span> {actor}
                            </div>
                            <div className="text-muted text-xs">
                              {count} film{count !== 1 ? "s" : ""} together
                            </div>
                          </div>
                          <span
                            className={`text-muted text-xs shrink-0 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            aria-hidden
                          >
                            ▾
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="mt-3 ml-7 pl-3 border-l border-card-border flex flex-wrap gap-3">
                            {slugs.map((slug) => {
                              const title =
                                titleBySlug.get(slug) ?? slug.replace(/-/g, " ");
                              const year = yearBySlug.get(slug);
                              return (
                                <a
                                  key={slug}
                                  href={`https://letterboxd.com/film/${slug}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex flex-col items-center gap-1 w-[68px] group"
                                >
                                  <Poster
                                    posterPath={posterBySlug.get(slug)}
                                    title={title}
                                    size={68}
                                  />
                                  <div className="text-center w-full">
                                    <div className="text-[11px] font-medium leading-tight line-clamp-2 group-hover:text-accent transition-colors">
                                      {title}
                                    </div>
                                    {year && (
                                      <div className="text-[10px] text-muted">
                                        {year}
                                      </div>
                                    )}
                                  </div>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
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

          {/* Highest-Rated Directors & Actors — Bayesian-weighted so a single
              5-star film doesn't crown an actor. Ranks by avg rating pulled
              toward the user's global mean by m=3 imaginary films, then
              filtered to people with 2+ rated films. */}
          {hasRatings && highestRatedPeople && (
            <div className="bg-card border border-card-border rounded-xl p-6">
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <h3 className="text-lg font-semibold">Your Highest-Rated People</h3>
                <span className="text-muted text-xs">
                  Weighted avg · min 2 films
                </span>
              </div>
              <p className="text-muted text-xs mb-4">
                Your global avg is {highestRatedPeople.globalMean.toFixed(2)}★ — scores are pulled toward it for people with few films so one-hit wonders don&apos;t dominate.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {highestRatedPeople.directors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
                      Directors
                    </h4>
                    <div className="space-y-2.5">
                      {highestRatedPeople.directors.map((p) => (
                        <a
                          key={p.name}
                          href={letterboxdPersonUrl("director", p.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 group hover:opacity-90 transition-opacity"
                          title={`View ${p.name} on Letterboxd`}
                        >
                          <Avatar
                            profilePath={peopleMap.get(p.name)?.profilePath}
                            name={p.name}
                            size={44}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate group-hover:text-accent group-hover:underline">
                              {p.name}
                            </div>
                            <div className="text-xs text-muted">
                              {p.count} film{p.count !== 1 ? "s" : ""}
                            </div>
                          </div>
                          <div className="text-accent font-bold tabular-nums">
                            {p.avg.toFixed(1)}
                            <span className="text-xs text-muted">/5</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {highestRatedPeople.actors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
                      Actors
                    </h4>
                    <div className="space-y-2.5">
                      {highestRatedPeople.actors.map((p) => (
                        <a
                          key={p.name}
                          href={letterboxdPersonUrl("actor", p.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 group hover:opacity-90 transition-opacity"
                          title={`View ${p.name} on Letterboxd`}
                        >
                          <Avatar
                            profilePath={peopleMap.get(p.name)?.profilePath}
                            name={p.name}
                            size={44}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate group-hover:text-accent group-hover:underline">
                              {p.name}
                            </div>
                            <div className="text-xs text-muted">
                              {p.count} film{p.count !== 1 ? "s" : ""}
                            </div>
                          </div>
                          <div className="text-accent font-bold tabular-nums">
                            {p.avg.toFixed(1)}
                            <span className="text-xs text-muted">/5</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
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
                    <div className="flex flex-wrap gap-2">
                      {fiveStarClub.topDirectors.map(([name, count]) => (
                        <span
                          key={name}
                          className="bg-accent/15 text-accent text-xs pl-0.5 pr-2.5 py-0.5 rounded-full flex items-center gap-1.5"
                        >
                          <Avatar
                            name={name}
                            profilePath={peopleMap.get(name)?.profilePath}
                            size={22}
                          />
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {fiveStarClub.topActors.length > 0 && (
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Actors</div>
                    <div className="flex flex-wrap gap-2">
                      {fiveStarClub.topActors.map(([name, count]) => (
                        <span
                          key={name}
                          className="bg-accent/15 text-accent text-xs pl-0.5 pr-2.5 py-0.5 rounded-full flex items-center gap-1.5"
                        >
                          <Avatar
                            name={name}
                            profilePath={peopleMap.get(name)?.profilePath}
                            size={22}
                          />
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
                    <div className="flex flex-wrap gap-2">
                      {likedFilmsClub.topDirectors.map(([name, count]) => (
                        <span
                          key={name}
                          className="bg-accent/15 text-accent text-xs pl-0.5 pr-2.5 py-0.5 rounded-full flex items-center gap-1.5"
                        >
                          <Avatar
                            name={name}
                            profilePath={peopleMap.get(name)?.profilePath}
                            size={22}
                          />
                          {name} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {likedFilmsClub.topActors.length > 0 && (
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wide mb-1">Actors</div>
                    <div className="flex flex-wrap gap-2">
                      {likedFilmsClub.topActors.map(([name, count]) => (
                        <span
                          key={name}
                          className="bg-accent/15 text-accent text-xs pl-0.5 pr-2.5 py-0.5 rounded-full flex items-center gap-1.5"
                        >
                          <Avatar
                            name={name}
                            profilePath={peopleMap.get(name)?.profilePath}
                            size={22}
                          />
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

  // Resolve TMDB headshots for the top-3 directors/actors shown in the
  // shared leaderboards. usePersonLookup already keys off the sorted name
  // list, so a fresh array each render doesn't refetch unnecessarily.
  const matchPeopleMap = usePersonLookup([
    ...topDirectors.map(([n]) => n),
    ...topActors.map(([n]) => n),
  ]);

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
                <PersonLeaderboard
                  items={topDirectors}
                  peopleMap={matchPeopleMap}
                  role="director"
                />
              ) : (
                <EnrichingPlaceholder />
              )}
            </div>
            <div className="bg-background rounded-lg p-4">
              <h5 className="text-sm font-semibold mb-2">
                Most Watched Genres
              </h5>
              {topGenres.length > 0 ? (
                <PieChart data={topGenres} size={140} />
              ) : (
                <EnrichingPlaceholder />
              )}
            </div>
            <div className="bg-background rounded-lg p-4">
              <h5 className="text-sm font-semibold mb-2">
                Most Watched Actors
              </h5>
              {topActors.length > 0 ? (
                <PersonLeaderboard
                  items={topActors}
                  peopleMap={matchPeopleMap}
                  role="actor"
                />
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
