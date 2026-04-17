/**
 * Client-side utilities for parsing Letterboxd data exports.
 *
 * Letterboxd lets users export all their data as a ZIP from
 * https://letterboxd.com/settings/data/
 *
 * The ZIP contains multiple CSVs we care about:
 *   ratings.csv       — Date, Name, Year, Letterboxd URI, Rating
 *   watched.csv       — Date, Name, Year, Letterboxd URI  (every logged film)
 *   likes/films.csv   — Date, Name, Year, Letterboxd URI  (hearted films)
 *   watchlist.csv     — Date, Name, Year, Letterboxd URI  (films to watch)
 *
 * We accept either the ZIP (preferred — gives us all four) or a single CSV
 * (backward-compatible with users who only upload ratings.csv).
 */

export interface CSVFilm {
  title: string;
  year: number | null;
  rating: number | null;
  slug: string;
  liked?: boolean;
  watchlisted?: boolean;
}

/* ---------- slug helpers ---------- */

/** Try to pull the slug out of a full Letterboxd URL. */
function extractSlugFromURI(uri: string): string {
  const m = uri.match(/letterboxd\.com\/film\/([^/]+)/);
  return m ? m[1] : "";
}

/** Check if the URI is a boxd.it short URL that needs redirect resolution. */
function isShortURI(uri: string): boolean {
  return /^https?:\/\/boxd\.it\//.test(uri.trim());
}

/**
 * Resolve boxd.it short URLs to real film slugs via the /api/resolve-slugs endpoint.
 * Mutates the films array in place, updating slug for any film whose URI resolved.
 * Batched 80 URLs at a time to stay within endpoint limit (100).
 */
async function resolveShortURIs(films: { slug: string; _uri?: string }[]): Promise<void> {
  const toResolve: { idx: number; uri: string }[] = [];
  for (let i = 0; i < films.length; i++) {
    const uri = films[i]._uri;
    if (uri && isShortURI(uri)) toResolve.push({ idx: i, uri });
  }
  if (toResolve.length === 0) return;

  const BATCH = 80;
  for (let i = 0; i < toResolve.length; i += BATCH) {
    const batch = toResolve.slice(i, i + BATCH);
    try {
      const resp = await fetch("/api/resolve-slugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: batch.map((b) => b.uri) }),
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as { slugs?: (string | null)[] };
      const resolved = json.slugs ?? [];
      for (let j = 0; j < batch.length; j++) {
        const newSlug = resolved[j];
        if (newSlug) films[batch[j].idx].slug = newSlug;
      }
    } catch {
      // Non-fatal — keep the title-generated slug fallback
    }
  }
}

/** Generate a best-effort slug from a film title. */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[''´`]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ---------- CSV parsing ---------- */

/** Parse a single CSV line, respecting quoted fields. */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

interface RawCSVRow {
  title: string;
  year: number | null;
  rating: number | null;
  slug: string;
  _uri: string;
}

/**
 * Parse any Letterboxd-export CSV that has the standard columns
 * (Name, Year, Letterboxd URI, and optionally Rating). Returns one row
 * per film. `rating` will be null for watched/likes/watchlist CSVs which
 * don't have that column.
 */
function parseFilmCSV(csvText: string): RawCSVRow[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const yearIdx = header.indexOf("year");
  const ratingIdx = header.indexOf("rating"); // -1 if CSV has no rating column
  const uriIdx = header.findIndex((h) => h.includes("letterboxd uri"));

  if (nameIdx === -1) return [];

  const rows: RawCSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const name = (cols[nameIdx] ?? "").trim();
    if (!name) continue;

    const yearStr = yearIdx >= 0 ? (cols[yearIdx] ?? "").trim() : "";
    const uri = uriIdx >= 0 ? (cols[uriIdx] ?? "").trim() : "";

    let rating: number | null = null;
    if (ratingIdx >= 0) {
      const ratingStr = (cols[ratingIdx] ?? "").trim();
      if (ratingStr) {
        const r = parseFloat(ratingStr);
        if (!isNaN(r) && r >= 0.5 && r <= 5) rating = r;
      }
    }

    const yearNum = yearStr ? parseInt(yearStr, 10) : null;
    const year = yearNum && !isNaN(yearNum) ? yearNum : null;
    const slug = extractSlugFromURI(uri) || generateSlug(name);

    rows.push({ title: name, year, rating, slug, _uri: uri });
  }

  return rows;
}

/**
 * Parse ONLY ratings.csv — kept for back-compat with callers that bypass the
 * full extractor (e.g. tests or direct-CSV uploads). Same behavior as before:
 * rows without a valid rating are excluded.
 */
export function parseRatingsCSV(csvText: string): CSVFilm[] {
  return parseFilmCSV(csvText)
    .filter((r) => r.rating != null)
    .map((r) => {
      const film = { title: r.title, year: r.year, rating: r.rating, slug: r.slug } as CSVFilm;
      (film as CSVFilm & { _uri: string })._uri = r._uri;
      return film;
    });
}

/* ---------- file handling ---------- */

/**
 * Merge four parallel CSVs (ratings/watched/likes/watchlist) into a single
 * keyed-by-slug film list. Ratings are the richest source; watched-but-unrated
 * films are included too so non-rating users still see their full library.
 * `liked` and `watchlisted` booleans are joined on by slug.
 */
function mergeSources(
  ratings: RawCSVRow[],
  watched: RawCSVRow[],
  likes: RawCSVRow[],
  watchlist: RawCSVRow[]
): (CSVFilm & { _uri?: string })[] {
  const bySlug = new Map<string, CSVFilm & { _uri?: string }>();

  const seed = (row: RawCSVRow) => {
    if (!row.slug) return;
    const existing = bySlug.get(row.slug);
    if (existing) {
      // Prefer the first non-null rating we find (ratings CSV wins because it's seeded first)
      if (existing.rating == null && row.rating != null) existing.rating = row.rating;
      if (!existing.year && row.year) existing.year = row.year;
      if (!existing._uri && row._uri) existing._uri = row._uri;
    } else {
      bySlug.set(row.slug, {
        title: row.title,
        year: row.year,
        rating: row.rating,
        slug: row.slug,
        _uri: row._uri,
      });
    }
  };

  // Order matters: ratings first so they seed the rating values, then watched
  // adds any unrated films, then likes/watchlist contribute extra titles and
  // set the booleans below.
  for (const r of ratings) seed(r);
  for (const r of watched) seed(r);
  for (const r of likes) seed(r);
  for (const r of watchlist) seed(r);

  for (const r of likes) {
    const film = bySlug.get(r.slug);
    if (film) film.liked = true;
  }
  for (const r of watchlist) {
    const film = bySlug.get(r.slug);
    if (film) film.watchlisted = true;
  }

  return [...bySlug.values()];
}

/**
 * Read a File (ZIP or CSV) and return parsed films.
 * JSZip is dynamically imported only when a ZIP is provided.
 *
 * When the user uploads the full ZIP we also pull watched/likes/watchlist so
 * users who never rate films still get a meaningful profile.
 */
export async function extractRatingsFromFile(file: File): Promise<CSVFilm[]> {
  let films: (CSVFilm & { _uri?: string })[];

  if (file.name.toLowerCase().endsWith(".zip")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(file);

    const readOptional = async (path: string): Promise<RawCSVRow[]> => {
      const entry = zip.file(path);
      if (!entry) return [];
      return parseFilmCSV(await entry.async("text"));
    };

    const ratings = await readOptional("ratings.csv");
    const watched = await readOptional("watched.csv");
    const likes = await readOptional("likes/films.csv");
    const watchlist = await readOptional("watchlist.csv");

    if (
      ratings.length === 0 &&
      watched.length === 0 &&
      likes.length === 0 &&
      watchlist.length === 0
    ) {
      throw new Error(
        "No film data found in the ZIP. Make sure this is a Letterboxd data export."
      );
    }

    films = mergeSources(ratings, watched, likes, watchlist);
  } else {
    // Direct-CSV upload: assume ratings.csv. Unrated rows are excluded (legacy
    // behavior) because we have no way of knowing if the CSV is watched/likes/etc.
    const csvText = await file.text();
    films = parseFilmCSV(csvText)
      .filter((r) => r.rating != null)
      .map((r) => ({
        title: r.title,
        year: r.year,
        rating: r.rating,
        slug: r.slug,
        _uri: r._uri,
      }));
  }

  // Resolve boxd.it short URLs to correct slugs. Falls back to title-generated
  // slugs silently if the resolver fails.
  await resolveShortURIs(films);

  // Strip transient _uri field before returning
  return films.map(({ title, year, rating, slug, liked, watchlisted }) => ({
    title,
    year,
    rating,
    slug,
    liked,
    watchlisted,
  }));
}
