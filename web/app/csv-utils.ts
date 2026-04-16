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

    films.push({ title: name, year, rating, slug });
  }

  return films;
}

/* ---------- file handling ---------- */

/**
 * Read a File (ZIP or CSV) and return parsed rated films.
 * JSZip is dynamically imported only when a ZIP is provided.
 */
export async function extractRatingsFromFile(file: File): Promise<CSVFilm[]> {
  if (file.name.toLowerCase().endsWith(".zip")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(file);
    const ratingsFile = zip.file("ratings.csv");
    if (!ratingsFile) {
      throw new Error(
        "No ratings.csv found in the ZIP. Make sure this is a Letterboxd data export."
      );
    }
    const csvText = await ratingsFile.async("text");
    return parseRatingsCSV(csvText);
  }

  // Plain CSV
  const csvText = await file.text();
  return parseRatingsCSV(csvText);
}
