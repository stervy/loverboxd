/**
 * Client-side utilities for parsing Letterboxd data exports.
 *
 * Letterboxd lets users export all their data as a ZIP from
 * https://letterboxd.com/settings/data/
 *
 * The ZIP contains ratings.csv with columns:
 *   Date, Name, Year, Letterboxd URI, Rating
 *
 * We accept either the ZIP or the CSV directly.
 */

export interface CSVFilm {
  title: string;
  year: number | null;
  rating: number;
  slug: string;
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

/** Parse a Letterboxd ratings.csv string into an array of films. */
export function parseRatingsCSV(csvText: string): CSVFilm[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const yearIdx = header.indexOf("year");
  const ratingIdx = header.indexOf("rating");
  const uriIdx = header.findIndex((h) => h.includes("letterboxd uri"));

  if (nameIdx === -1 || ratingIdx === -1) return [];

  const films: CSVFilm[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const name = (cols[nameIdx] ?? "").trim();
    const yearStr = yearIdx >= 0 ? (cols[yearIdx] ?? "").trim() : "";
    const ratingStr = (cols[ratingIdx] ?? "").trim();
    const uri = uriIdx >= 0 ? (cols[uriIdx] ?? "").trim() : "";

    if (!name || !ratingStr) continue;

    const rating = parseFloat(ratingStr);
    if (isNaN(rating) || rating < 0.5 || rating > 5) continue;

    const yearNum = yearStr ? parseInt(yearStr, 10) : null;
    const year = yearNum && !isNaN(yearNum) ? yearNum : null;
    const slug = extractSlugFromURI(uri) || generateSlug(name);

    // Stash the original URI so we can later resolve boxd.it short URLs.
    // Prefixed with _ to signal it's transient — stripped before returning.
    films.push({ title: name, year, rating, slug, _uri: uri } as CSVFilm & { _uri: string });
  }

  return films;
}

/* ---------- file handling ---------- */

/**
 * Read a File (ZIP or CSV) and return parsed rated films.
 * JSZip is dynamically imported only when a ZIP is provided.
 */
export async function extractRatingsFromFile(file: File): Promise<CSVFilm[]> {
  let csvText: string;
  if (file.name.toLowerCase().endsWith(".zip")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(file);
    const ratingsFile = zip.file("ratings.csv");
    if (!ratingsFile) {
      throw new Error(
        "No ratings.csv found in the ZIP. Make sure this is a Letterboxd data export."
      );
    }
    csvText = await ratingsFile.async("text");
  } else {
    csvText = await file.text();
  }

  const films = parseRatingsCSV(csvText);
  // Resolve boxd.it short URLs to correct slugs. Falls back to title-generated
  // slugs silently if the resolver fails.
  await resolveShortURIs(films as (CSVFilm & { _uri?: string })[]);
  // Strip transient _uri field before returning
  return films.map(({ title, year, rating, slug }) => ({ title, year, rating, slug }));
}
