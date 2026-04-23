// Simple in-memory cache with TTL
// Persists across warm Vercel serverless invocations

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// 24h for scraped data. Letterboxd profiles don't change minute-to-minute,
// and scraping burns ScraperAPI credits — 24h cuts the credit cost of repeat
// views of the same profile by ~24× vs. the old 1h. Note: the cache is still
// per-Vercel-container and in-memory, so cold starts reset it; 24h is an
// upper bound, not a guarantee.
const SCRAPED_TTL = 24 * 60 * 60 * 1000;
// Short TTL on RSS-only fallbacks so we don't lock in degraded data when
// scraping was temporarily blocked.
const RSS_TTL = 5 * 60 * 1000;
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
