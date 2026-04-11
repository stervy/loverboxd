"""Client for Letterboxd's unauthenticated API v0 endpoints.

The search endpoint at api.letterboxd.com/api/v0/search works without
authentication and returns rich JSON data for films and members.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import httpx

API_BASE = "https://api.letterboxd.com/api/v0"


@dataclass
class FilmResult:
    id: str  # Letterboxd ID like "hTha"
    name: str
    slug: str = ""
    release_year: int | None = None
    runtime: int | None = None
    rating: float | None = None  # community average, e.g. 4.526
    poster_url: str = ""
    top250_position: int | None = None
    directors: list[str] = field(default_factory=list)
    link: str = ""


@dataclass
class MemberResult:
    id: str
    username: str
    display_name: str = ""
    avatar_url: str = ""
    member_status: str = ""  # e.g. "Patron", "Member", "Pro"


def _slug_from_link(link: str) -> str:
    """Extract slug from a Letterboxd URL like https://letterboxd.com/film/parasite-2019/"""
    parts = link.rstrip("/").split("/")
    return parts[-1] if parts else ""


def search_films(query: str, per_page: int = 20, cursor: str = "") -> tuple[list[FilmResult], str]:
    """Search for films via the unauthenticated API.

    Returns (results, next_cursor). Pass next_cursor to get the next page.
    """
    params = {"input": query, "include": "FilmSearchItem", "perPage": per_page}
    if cursor:
        params["cursor"] = cursor

    resp = httpx.get(f"{API_BASE}/search", params=params, follow_redirects=True, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("items", []):
        film = item.get("film", {})
        poster_url = ""
        poster = film.get("poster", {})
        sizes = poster.get("sizes", [])
        if sizes:
            poster_url = sizes[-1].get("url", "")  # largest

        directors = []
        for d in film.get("directors", []):
            directors.append(d.get("name", ""))

        results.append(FilmResult(
            id=film.get("id", ""),
            name=film.get("name", ""),
            slug=_slug_from_link(film.get("link", "")),
            release_year=film.get("releaseYear"),
            runtime=film.get("runTime"),
            rating=film.get("rating"),
            poster_url=poster_url,
            top250_position=film.get("top250Position"),
            directors=directors,
            link=film.get("link", ""),
        ))

    next_cursor = data.get("next", "").replace("cursor=", "")
    return results, next_cursor


def search_members(query: str, per_page: int = 20, cursor: str = "") -> tuple[list[MemberResult], str]:
    """Search for members via the unauthenticated API."""
    params = {"input": query, "include": "MemberSearchItem", "perPage": per_page}
    if cursor:
        params["cursor"] = cursor

    resp = httpx.get(f"{API_BASE}/search", params=params, follow_redirects=True, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("items", []):
        member = item.get("member", {})
        avatar_url = ""
        avatar = member.get("avatar", {})
        sizes = avatar.get("sizes", [])
        if sizes:
            avatar_url = sizes[-1].get("url", "")

        results.append(MemberResult(
            id=member.get("id", ""),
            username=member.get("username", ""),
            display_name=member.get("displayName", ""),
            avatar_url=avatar_url,
            member_status=member.get("memberStatus", ""),
        ))

    next_cursor = data.get("next", "").replace("cursor=", "")
    return results, next_cursor
