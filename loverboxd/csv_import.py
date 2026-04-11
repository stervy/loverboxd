"""Import data from Letterboxd CSV exports (Settings > Import & Export > Export)."""

from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CSVFilm:
    title: str
    year: int | None = None
    letterboxd_uri: str = ""
    rating: float | None = None
    watch_date: str = ""
    is_rewatch: bool = False
    tags: list[str] | None = None


def _read_csv(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def load_export(path: str | Path) -> dict[str, list[dict]]:
    """Load a Letterboxd ZIP export. Returns dict of filename -> list of row dicts."""
    path = Path(path)
    data: dict[str, list[dict]] = {}
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if name.endswith(".csv"):
                    text = zf.read(name).decode("utf-8")
                    data[name] = _read_csv(text)
    elif path.suffix == ".csv":
        text = path.read_text(encoding="utf-8")
        data[path.name] = _read_csv(text)
    return data


def parse_ratings(rows: list[dict]) -> list[CSVFilm]:
    """Parse the ratings.csv rows."""
    films: list[CSVFilm] = []
    for row in rows:
        rating = None
        if row.get("Rating"):
            try:
                rating = float(row["Rating"])
            except ValueError:
                pass
        year = None
        if row.get("Year"):
            try:
                year = int(row["Year"])
            except ValueError:
                pass
        films.append(CSVFilm(
            title=row.get("Name", ""),
            year=year,
            letterboxd_uri=row.get("Letterboxd URI", ""),
            rating=rating,
        ))
    return films


def parse_diary(rows: list[dict]) -> list[CSVFilm]:
    """Parse the diary.csv rows."""
    films: list[CSVFilm] = []
    for row in rows:
        rating = None
        if row.get("Rating"):
            try:
                rating = float(row["Rating"])
            except ValueError:
                pass
        year = None
        if row.get("Year"):
            try:
                year = int(row["Year"])
            except ValueError:
                pass
        tags = row.get("Tags", "").split(", ") if row.get("Tags") else []
        films.append(CSVFilm(
            title=row.get("Name", ""),
            year=year,
            letterboxd_uri=row.get("Letterboxd URI", ""),
            rating=rating,
            watch_date=row.get("Watched Date", ""),
            is_rewatch=row.get("Rewatch", "").lower() == "yes",
            tags=tags,
        ))
    return films


def parse_watched(rows: list[dict]) -> list[CSVFilm]:
    """Parse the watched.csv rows."""
    return [
        CSVFilm(
            title=row.get("Name", ""),
            year=int(row["Year"]) if row.get("Year") else None,
            letterboxd_uri=row.get("Letterboxd URI", ""),
        )
        for row in rows
    ]
