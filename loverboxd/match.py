"""Find users with similar taste on Letterboxd.

Two matching strategies:

1. **Network match** — Compare your ratings against your following/followers
   via their RSS feeds (fast, no heavy scraping).

2. **Discovery match** — For your top-rated films, visit the film's /members/
   page to discover strangers who rated them similarly, then score by overlap
   and rating agreement.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass, field

from .rss import fetch_rss, RSSEntry
from .scraper import Film, get_film_fans, REQUEST_DELAY
from .stats import RatedFilm, from_rss


@dataclass
class UserMatch:
    username: str
    overlap_count: int = 0
    rating_agreement: float = 0.0  # avg absolute difference (lower = more similar)
    cosine_similarity: float = 0.0
    similarity_score: float = 0.0  # composite 0-100
    shared_films: list[str] = field(default_factory=list)


@dataclass
class DiscoveryConfig:
    min_rating_to_sample: float = 4.0  # only probe films rated this or higher
    max_films_to_sample: int = 20  # how many top films to use as probes
    max_members_pages: int = 2  # pages of /members/ per film
    min_overlap: int = 3  # minimum shared films to consider


def _build_rating_map(films: list[RatedFilm]) -> dict[str, float]:
    """Build title->rating map using lowercase title+year as key."""
    ratings: dict[str, float] = {}
    for f in films:
        if f.rating is not None:
            key = f"{f.title.lower().strip()} ({f.year})" if f.year else f.title.lower().strip()
            ratings[key] = f.rating
    return ratings


def _cosine_sim(a: dict[str, float], b: dict[str, float]) -> float:
    shared = set(a) & set(b)
    if not shared:
        return 0.0
    dot = sum(a[k] * b[k] for k in shared)
    mag_a = math.sqrt(sum(a[k] ** 2 for k in shared))
    mag_b = math.sqrt(sum(b[k] ** 2 for k in shared))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


# ── Compare two known users ────────────────────────────────────────────────


def compare_users(
    user_films: list[RatedFilm],
    other_films: list[RatedFilm],
    other_username: str = "",
) -> UserMatch:
    """Compare two users' rating profiles."""
    a = _build_rating_map(user_films)
    b = _build_rating_map(other_films)
    shared_keys = set(a) & set(b)
    overlap = len(shared_keys)

    if overlap == 0:
        return UserMatch(username=other_username)

    diffs = [abs(a[k] - b[k]) for k in shared_keys]
    avg_diff = sum(diffs) / len(diffs)
    cos_sim = _cosine_sim(a, b)

    overlap_norm = min(overlap / 20, 1.0)
    agreement_norm = 1 - (avg_diff / 5.0)
    score = round((0.3 * overlap_norm + 0.3 * agreement_norm + 0.4 * cos_sim) * 100, 1)

    return UserMatch(
        username=other_username,
        overlap_count=overlap,
        rating_agreement=round(avg_diff, 2),
        cosine_similarity=round(cos_sim, 3),
        similarity_score=score,
        shared_films=sorted(shared_keys)[:10],
    )


# ── Network match (compare against known usernames via RSS) ─────────────────


def find_matches_from_rss(
    user_films: list[RatedFilm],
    usernames: list[str],
) -> list[UserMatch]:
    """Compare the user against a list of other users via their RSS feeds."""
    matches: list[UserMatch] = []
    for username in usernames:
        try:
            entries = fetch_rss(username)
            other_films = from_rss(entries)
            match = compare_users(user_films, other_films, username)
            if match.overlap_count > 0:
                matches.append(match)
        except Exception:
            continue
    matches.sort(key=lambda m: m.similarity_score, reverse=True)
    return matches


def find_matches_from_followers(
    username: str,
    compare_usernames: list[str],
) -> list[UserMatch]:
    """Convenience: fetch user's RSS, then compare against a list of usernames."""
    entries = fetch_rss(username)
    user_films = from_rss(entries)
    return find_matches_from_rss(user_films, compare_usernames)


# ── Discovery match (find strangers via film member pages) ──────────────────


def discover_similar_users(
    user_films: list[Film],
    config: DiscoveryConfig | None = None,
) -> list[UserMatch]:
    """Find similar users by scanning who else rated your top films highly.

    Args:
        user_films: The target user's rated films (from scraper.get_rated_films).
        config: Discovery configuration.

    Returns:
        List of UserMatch sorted by similarity_score descending.
    """
    if config is None:
        config = DiscoveryConfig()

    # Select top-rated films as probes
    top_films = sorted(
        [f for f in user_films if f.rating and f.rating >= config.min_rating_to_sample],
        key=lambda f: f.rating,
        reverse=True,
    )[:config.max_films_to_sample]

    if not top_films:
        return []

    # Build user's own rating map (slug-based)
    user_ratings: dict[str, float] = {}
    for f in user_films:
        if f.rating and f.slug:
            user_ratings[f.slug] = f.rating

    # Scan other users who also rated these films
    candidate_ratings: dict[str, dict[str, float]] = defaultdict(dict)
    candidate_shared_titles: dict[str, list[str]] = defaultdict(list)

    for film in top_films:
        fans = get_film_fans(film.slug, max_pages=config.max_members_pages)
        for other_user, other_rating in fans.items():
            candidate_ratings[other_user][film.slug] = other_rating
            candidate_shared_titles[other_user].append(film.title)
        time.sleep(REQUEST_DELAY)

    # Score candidates
    matches: list[UserMatch] = []
    for other_user, their_ratings in candidate_ratings.items():
        overlap = len(their_ratings)
        if overlap < config.min_overlap:
            continue

        diffs = []
        for slug, their_r in their_ratings.items():
            if slug in user_ratings:
                diffs.append(abs(user_ratings[slug] - their_r))
        avg_diff = sum(diffs) / len(diffs) if diffs else 2.5

        max_possible = len(top_films)
        overlap_score = overlap / max_possible
        agreement_score = 1 - (avg_diff / 5.0)
        similarity = round((0.6 * overlap_score + 0.4 * agreement_score) * 100, 1)

        matches.append(UserMatch(
            username=other_user,
            overlap_count=overlap,
            rating_agreement=round(avg_diff, 2),
            similarity_score=similarity,
            shared_films=candidate_shared_titles[other_user][:5],
        ))

    matches.sort(key=lambda m: m.similarity_score, reverse=True)
    return matches
