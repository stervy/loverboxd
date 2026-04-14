// Simple in-memory cache with TTL
// Persists across warm Vercel serverless invocations

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const SCRAPED_TTL = 60 * 60 * 1000; // 1 hour for full scraped data
const RSS_TTL = 5 * 60 * 1000; // 5 minutes for RSS-only (so it retries scraping sooner)
const FILM_DETAILS_TTL = 24 * 60 * 60 * 1000; // 24 hours for film metadata (rarely changes)

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(
  key: string,
  data: T,
  source: "scraped" | "rss" | "film-details"
): void {
  const ttl =
    source === "film-details"
      ? FILM_DETAILS_TTL
      : source === "scraped"
        ? SCRAPED_TTL
        : RSS_TTL;
  store.set(key, { data, expiresAt: Date.now() + ttl });
}

// Evict expired entries periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 10 * 60 * 1000); // every 10 minutes
