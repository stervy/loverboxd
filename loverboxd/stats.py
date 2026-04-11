"""Compute viewing statistics from RSS, CSV, or scraped data."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .rss import RSSEntry
from .csv_import import CSVFilm


@dataclass
class RatedFilm:
    """Unified representation of a rated film from any source."""
    title: str
    year: int | None = None
    rating: float | None = None
    watch_date: str = ""
    is_rewatch: bool = False
    slug: str = ""


@dataclass
class UserStats:
    username: str
    total_films: int = 0
    total_rated: int = 0
    average_rating: float = 0.0
    rating_distribution: dict[float, int] = field(default_factory=dict)
    most_watched_year: str = ""
    films_by_decade: dict[str, int] = field(default_factory=dict)
    films_by_month: dict[str, int] = field(default_factory=dict)
    highest_rated: list[RatedFilm] = field(default_factory=list)
    lowest_rated: list[RatedFilm] = field(default_factory=list)
    total_rewatches: int = 0


def from_rss(entries: list[RSSEntry]) -> list[RatedFilm]:
    """Convert RSS entries to RatedFilm list."""
    return [
        RatedFilm(
            title=e.film_title,
            year=e.film_year,
            rating=e.rating,
            watch_date=e.watch_date,
            is_rewatch=e.is_rewatch,
        )
        for e in entries
    ]


def from_csv(films: list[CSVFilm]) -> list[RatedFilm]:
    """Convert CSV films to RatedFilm list."""
    return [
        RatedFilm(
            title=f.title,
            year=f.year,
            rating=f.rating,
            watch_date=f.watch_date,
            is_rewatch=f.is_rewatch,
        )
        for f in films
    ]


def compute_stats(username: str, films: list[RatedFilm]) -> UserStats:
    """Compute aggregate stats from a list of rated films."""
    stats = UserStats(username=username, total_films=len(films))

    # Ratings
    rated = [f for f in films if f.rating is not None]
    stats.total_rated = len(rated)
    if rated:
        stats.average_rating = round(sum(f.rating for f in rated) / len(rated), 2)

    # Rating distribution (0.5, 1.0, ..., 5.0)
    dist: dict[float, int] = {}
    for f in rated:
        dist[f.rating] = dist.get(f.rating, 0) + 1
    stats.rating_distribution = dict(sorted(dist.items()))

    # Highest / lowest rated
    sorted_rated = sorted(rated, key=lambda f: f.rating, reverse=True)
    stats.highest_rated = sorted_rated[:10]
    stats.lowest_rated = sorted_rated[-10:] if len(sorted_rated) > 10 else []

    # Films by decade
    decade_counter: Counter[str] = Counter()
    for f in films:
        if f.year:
            decade = f"{(f.year // 10) * 10}s"
            decade_counter[decade] += 1
    stats.films_by_decade = dict(decade_counter.most_common())

    # Time-based stats from watch dates
    stats.total_rewatches = sum(1 for f in films if f.is_rewatch)

    month_counter: Counter[str] = Counter()
    year_counter: Counter[str] = Counter()
    for f in films:
        if f.watch_date:
            parts = f.watch_date.split("-")
            if len(parts) >= 2:
                month_counter[parts[1]] += 1
            if len(parts) >= 1:
                year_counter[parts[0]] += 1
    stats.films_by_month = dict(sorted(month_counter.items()))
    if year_counter:
        stats.most_watched_year = year_counter.most_common(1)[0][0]

    return stats
