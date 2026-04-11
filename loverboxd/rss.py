"""Parse Letterboxd RSS feeds for recent activity."""

from __future__ import annotations

from dataclasses import dataclass

import feedparser
import httpx

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}


@dataclass
class RSSEntry:
    title: str
    film_title: str
    film_year: int | None
    rating: float | None  # 0.5–5.0
    watch_date: str  # YYYY-MM-DD or empty
    is_rewatch: bool
    review_html: str
    link: str
    poster_url: str


def fetch_rss(username: str) -> list[RSSEntry]:
    """Fetch and parse a user's Letterboxd RSS feed (~50 most recent entries)."""
    url = f"https://letterboxd.com/{username}/rss/"
    resp = httpx.get(url, headers=HEADERS, follow_redirects=True, timeout=15)
    resp.raise_for_status()

    feed = feedparser.parse(resp.text)
    entries: list[RSSEntry] = []

    for item in feed.entries:
        # Extract letterboxd-specific fields
        rating = None
        if hasattr(item, "letterboxd_memberrating"):
            try:
                rating = float(item.letterboxd_memberrating)
            except (ValueError, TypeError):
                pass

        watch_date = getattr(item, "letterboxd_watcheddate", "")
        is_rewatch = getattr(item, "letterboxd_rewatch", "No") == "Yes"
        film_title = getattr(item, "letterboxd_filmtitle", item.get("title", ""))
        film_year = None
        if hasattr(item, "letterboxd_filmyear"):
            try:
                film_year = int(item.letterboxd_filmyear)
            except (ValueError, TypeError):
                pass

        # Poster image
        poster_url = ""
        description = item.get("summary", "")
        if 'src="' in description:
            poster_url = description.split('src="')[1].split('"')[0]

        entries.append(RSSEntry(
            title=item.get("title", ""),
            film_title=film_title,
            film_year=film_year,
            rating=rating,
            watch_date=watch_date,
            is_rewatch=is_rewatch,
            review_html=description,
            link=item.get("link", ""),
            poster_url=poster_url,
        ))

    return entries
