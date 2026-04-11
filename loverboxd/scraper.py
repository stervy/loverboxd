"""Scrape public Letterboxd profile pages, film lists, and rating pages.

Key discoveries:
1. Adding 'X-Requested-With: XMLHttpRequest' header helps bypass Cloudflare.
2. Using a session client and warming up with a profile page first establishes
   the cookies needed for subsequent requests to succeed.
3. The API search endpoint (api.letterboxd.com/api/v0/search) works without auth.
"""

from __future__ import annotations

import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, field

import httpx
from bs4 import BeautifulSoup, Tag

BASE = "https://letterboxd.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://letterboxd.com/",
}
REQUEST_DELAY = 1.0  # seconds between requests


@dataclass
class Film:
    title: str
    slug: str
    year: int | None = None
    rating: float | None = None  # 0.5–5.0
    liked: bool = False
    letterboxd_id: str | None = None


@dataclass
class FilmDetails:
    title: str
    slug: str
    year: int | None = None
    average_rating: float | None = None
    genres: list[str] = field(default_factory=list)
    runtime: int | None = None  # minutes
    director: str = ""
    synopsis: str = ""


@dataclass
class ProfileStats:
    username: str
    display_name: str = ""
    bio: str = ""
    films_watched: int = 0
    films_this_year: int = 0
    lists_count: int = 0
    following: int = 0
    followers: int = 0
    favorite_films: list[str] = field(default_factory=list)


@dataclass
class DiaryEntry:
    film: Film
    watch_date: str  # YYYY-MM-DD
    is_rewatch: bool = False
    review_snippet: str = ""


@contextmanager
def _session(username: str = ""):
    """Create an HTTP session with Cloudflare cookie warmup."""
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=15) as client:
        # Warm up: hit a page that always works to establish CF cookies
        warmup_path = f"/{username}/" if username else "/"
        client.get(f"{BASE}{warmup_path}")
        yield client


def _get(path: str, client: httpx.Client) -> BeautifulSoup:
    url = f"{BASE}{path}" if path.startswith("/") else path
    resp = client.get(url)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "lxml")


def _parse_rating(el: Tag) -> float | None:
    """Extract numeric rating from a tag with class like 'rated-8' (= 4.0 stars)."""
    for cls in el.get("class", []):
        if cls.startswith("rated-"):
            try:
                return int(cls.split("-")[1]) / 2
            except (ValueError, IndexError):
                pass
    return None


def _parse_int(text: str) -> int:
    return int(text.strip().replace(",", "").replace(".", "")) if text.strip() else 0


def _parse_year_from_display_name(display_name: str) -> tuple[str, int | None]:
    """Parse 'Film Title (2024)' into ('Film Title', 2024)."""
    m = re.match(r"^(.+?)\s*\((\d{4})\)$", display_name)
    if m:
        return m.group(1), int(m.group(2))
    return display_name, None


# ── Profile ─────────────────────────────────────────────────────────────────


def get_profile(username: str) -> ProfileStats:
    """Fetch basic profile stats for a user."""
    with _session(username) as client:
        soup = _get(f"/{username}/", client)

    stats = ProfileStats(username=username)

    name_el = soup.select_one(".displayname")
    if name_el:
        stats.display_name = name_el.get_text(strip=True)

    bio_el = soup.select_one(".body-text.-bio")
    if bio_el:
        stats.bio = bio_el.get_text(strip=True)

    for stat_el in soup.select(".profile-stats a"):
        value_el = stat_el.select_one(".value")
        if not value_el:
            continue
        val = _parse_int(value_el.get_text())
        href = stat_el.get("href", "")
        if "/films/" in href:
            stats.films_watched = val
        elif "/following/" in href:
            stats.following = val
        elif "/followers/" in href:
            stats.followers = val
        elif "/lists/" in href:
            stats.lists_count = val

    year_el = soup.select_one(".profile-stats .stat a[href*='/films/year/']")
    if year_el:
        val_el = year_el.select_one(".value")
        if val_el:
            stats.films_this_year = _parse_int(val_el.get_text())

    fav_section = soup.select_one("#favourites")
    if fav_section:
        for img in fav_section.select("img"):
            alt = img.get("alt", "")
            if alt:
                stats.favorite_films.append(alt)

    return stats


# ── Rated Films (paginated HTML scraping) ───────────────────────────────────


def get_rated_films(username: str, max_pages: int = 50) -> list[Film]:
    """Scrape all rated films for a user (paginated).

    The ratings page uses React components with data attributes like
    data-item-full-display-name, data-film-id, and data-item-link.
    Ratings are in sibling <span class="rating rated-N"> elements.
    """
    films: list[Film] = []
    with _session(username) as client:
        for page in range(1, max_pages + 1):
            soup = _get(f"/{username}/films/ratings/page/{page}/", client)
            items = soup.select("li.griditem")
            if not items:
                break
            for li in items:
                rc = li.select_one(".react-component")
                if not rc:
                    continue

                display_name = rc.get("data-item-full-display-name", "")
                title, year = _parse_year_from_display_name(display_name)

                link = rc.get("data-item-link", "")
                slug = link.strip("/").split("/")[-1] if link else ""
                film_id = rc.get("data-film-id")

                rating_el = li.select_one(".rating")
                rating = _parse_rating(rating_el) if rating_el else None

                films.append(Film(
                    title=title,
                    slug=slug,
                    year=year,
                    rating=rating,
                    letterboxd_id=film_id,
                ))
            if page < max_pages:
                time.sleep(REQUEST_DELAY)
    return films


# ── Diary ───────────────────────────────────────────────────────────────────


def get_diary(username: str, max_pages: int = 10) -> list[DiaryEntry]:
    """Scrape diary entries."""
    entries: list[DiaryEntry] = []
    with _session(username) as client:
        for page in range(1, max_pages + 1):
            soup = _get(f"/{username}/films/diary/page/{page}/", client)
            rows = soup.select("tr.diary-entry-row")
            if not rows:
                break
            for row in rows:
                # Film info from the react component in the poster cell
                rc = row.select_one(".react-component")
                if rc:
                    display_name = rc.get("data-item-full-display-name", "")
                    title, year = _parse_year_from_display_name(display_name)
                    link = rc.get("data-item-link", "")
                    slug = link.strip("/").split("/")[-1] if link else ""
                else:
                    # Fallback: try the film details cell
                    name_el = row.select_one("td.td-film-details h3 a")
                    if not name_el:
                        continue
                    title = name_el.get_text(strip=True)
                    year = None
                    slug = name_el.get("href", "").split("/film/")[-1].strip("/")

                rating_el = row.select_one("td.td-rating .rating")
                rating = _parse_rating(rating_el) if rating_el else None

                # Date from calendar cell
                date_el = row.select_one("td.td-calendar a")
                watch_date = ""
                if date_el:
                    href = date_el.get("href", "")
                    parts = href.strip("/").split("/")
                    if len(parts) >= 3:
                        watch_date = "-".join(parts[-3:])

                is_rewatch = bool(row.select_one("td.td-rewatch .icon-rewatch"))

                film = Film(title=title, slug=slug, year=year, rating=rating)
                entries.append(DiaryEntry(
                    film=film, watch_date=watch_date, is_rewatch=is_rewatch,
                ))
            if page < max_pages:
                time.sleep(REQUEST_DELAY)
    return entries


# ── Watched Film Slugs (lighter weight) ─────────────────────────────────────


def get_watched_film_slugs(username: str, max_pages: int = 100) -> list[str]:
    """Get just the slugs of all watched films."""
    slugs: list[str] = []
    with _session(username) as client:
        for page in range(1, max_pages + 1):
            soup = _get(f"/{username}/films/page/{page}/", client)
            for rc in soup.select(".react-component[data-item-link]"):
                link = rc.get("data-item-link", "")
                slug = link.strip("/").split("/")[-1] if link else ""
                if slug:
                    slugs.append(slug)
            if not soup.select(".react-component[data-item-link]"):
                break
            if page < max_pages:
                time.sleep(REQUEST_DELAY)
    return slugs


# ── Film Details ────────────────────────────────────────────────────────────


def get_film_details(slug: str) -> FilmDetails:
    """Fetch details for a single film page."""
    with _session() as client:
        soup = _get(f"/film/{slug}/", client)

    details = FilmDetails(title="", slug=slug)

    title_el = soup.select_one("h1.headline-1")
    if title_el:
        details.title = title_el.get_text(strip=True)

    year_el = soup.select_one("a[href*='/films/year/']")
    if year_el:
        try:
            details.year = int(year_el.get_text(strip=True))
        except ValueError:
            pass

    rating_el = soup.select_one("meta[name='twitter:data2']")
    if rating_el:
        try:
            text = rating_el.get("content", "")
            details.average_rating = float(text.split(" ")[0])
        except (ValueError, IndexError):
            pass

    director_el = soup.select_one("a[href*='/director/']")
    if director_el:
        details.director = director_el.get_text(strip=True)

    for genre_el in soup.select("a[href*='/films/genre/']"):
        details.genres.append(genre_el.get_text(strip=True))

    synopsis_el = soup.select_one("div.review.body-text p")
    if synopsis_el:
        details.synopsis = synopsis_el.get_text(strip=True)

    for el in soup.select("p.text-link"):
        text = el.get_text()
        if "mins" in text:
            try:
                details.runtime = int(text.strip().split()[0])
            except (ValueError, IndexError):
                pass

    return details


# ── Following/Followers ─────────────────────────────────────────────────────


def get_following(username: str, max_pages: int = 10) -> list[str]:
    """Get usernames that this user follows."""
    usernames: list[str] = []
    with _session(username) as client:
        for page in range(1, max_pages + 1):
            soup = _get(f"/{username}/following/page/{page}/", client)
            links = soup.select("a.name")
            if not links:
                break
            for a in links:
                href = a.get("href", "").strip("/")
                if href and "/" not in href:
                    usernames.append(href)
            if page < max_pages:
                time.sleep(REQUEST_DELAY)
    return usernames


def get_followers(username: str, max_pages: int = 10) -> list[str]:
    """Get usernames that follow this user."""
    usernames: list[str] = []
    with _session(username) as client:
        for page in range(1, max_pages + 1):
            soup = _get(f"/{username}/followers/page/{page}/", client)
            links = soup.select("a.name")
            if not links:
                break
            for a in links:
                href = a.get("href", "").strip("/")
                if href and "/" not in href:
                    usernames.append(href)
            if page < max_pages:
                time.sleep(REQUEST_DELAY)
    return usernames


# ── Film Members (who rated a film) ─────────────────────────────────────────


def get_film_fans(slug: str, max_pages: int = 5) -> dict[str, float]:
    """Get {username: rating} for users who rated a film."""
    fans: dict[str, float] = {}
    with _session() as client:
        for page in range(1, max_pages + 1):
            soup = _get(f"/film/{slug}/members/rated/.5-5/page/{page}/", client)
            rows = soup.select("tr")
            found_any = False
            for row in rows:
                name_el = row.select_one("a.name")
                rating_el = row.select_one(".rating")
                if not name_el:
                    continue
                found_any = True
                uname = name_el.get("href", "").strip("/").split("/")[0]
                rating = _parse_rating(rating_el) if rating_el else None
                if rating and uname:
                    fans[uname] = rating
            if not found_any:
                break
            if page < max_pages:
                time.sleep(REQUEST_DELAY)
    return fans
