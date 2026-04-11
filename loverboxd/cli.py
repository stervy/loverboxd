"""CLI interface for loverboxd."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="loverboxd — unofficial Letterboxd stats & user-matching toolkit")
console = Console()


@app.command()
def stats(
    username: str = typer.Argument(help="Letterboxd username"),
    full: bool = typer.Option(False, help="Scrape all rated films (slower, but complete)"),
    max_pages: int = typer.Option(50, help="Max pages to scrape when using --full"),
):
    """Show viewing stats for a Letterboxd user."""
    from .scraper import get_profile, get_rated_films, get_diary
    from .rss import fetch_rss
    from .stats import compute_stats, from_rss, RatedFilm

    with console.status(f"Fetching profile for {username}..."):
        profile = get_profile(username)

    console.print(f"\n[bold]{profile.display_name or username}[/bold]")
    if profile.bio:
        console.print(f"  {profile.bio[:120]}")
    console.print(f"  Films: {profile.films_watched}  |  This year: {profile.films_this_year}"
                  f"  |  Following: {profile.following}  |  Followers: {profile.followers}")
    if profile.favorite_films:
        console.print(f"  Favorites: {', '.join(profile.favorite_films)}")

    if full:
        with console.status("Scraping all rated films (this may take a while)..."):
            scraped = get_rated_films(username, max_pages=max_pages)
        with console.status("Scraping diary..."):
            diary = get_diary(username, max_pages=10)
        films = [
            RatedFilm(
                title=f.title, slug=f.slug, year=f.year, rating=f.rating,
            )
            for f in scraped
        ]
        # Merge diary data for watch dates
        diary_dates = {e.film.slug: (e.watch_date, e.is_rewatch) for e in diary}
        for f in films:
            if f.slug in diary_dates:
                f.watch_date, f.is_rewatch = diary_dates[f.slug]
        source = f"{len(scraped)} rated films (full scrape)"
    else:
        with console.status("Fetching RSS feed..."):
            entries = fetch_rss(username)
            films = from_rss(entries)
        source = f"{len(entries)} recent RSS entries"

    s = compute_stats(username, films)

    console.print(f"\n[bold]Rating Stats[/bold] ({source})")
    console.print(f"  Rated: {s.total_rated}  |  Average: {s.average_rating}")

    if s.rating_distribution:
        table = Table(title="Rating Distribution", show_header=True)
        table.add_column("Stars", style="yellow")
        table.add_column("Count", justify="right")
        table.add_column("Bar")
        max_count = max(s.rating_distribution.values())
        for rating, count in s.rating_distribution.items():
            stars = int(rating)
            half = "½" if rating % 1 else ""
            bar = "█" * int(count / max_count * 30) if max_count > 0 else ""
            table.add_row(f"{'★' * stars}{half}", str(count), bar)
        console.print(table)

    if s.highest_rated:
        console.print("\n[bold]Top Rated[/bold]")
        for f in s.highest_rated[:5]:
            stars = int(f.rating)
            half = "½" if f.rating % 1 else ""
            console.print(f"  {'★' * stars}{half}  {f.title}")

    if s.films_by_decade:
        console.print("\n[bold]By Decade[/bold]")
        for decade, count in sorted(s.films_by_decade.items()):
            console.print(f"  {decade}: {count}")

    if s.total_rewatches:
        console.print(f"\n  Rewatches: {s.total_rewatches}")

    if not full:
        console.print(f"\n[dim]Tip: use --full for complete stats from all rated films.[/dim]")


@app.command()
def feed(
    username: str = typer.Argument(help="Letterboxd username"),
    limit: int = typer.Option(20, help="Number of entries to show"),
):
    """Show recent activity from a user's RSS feed."""
    from .rss import fetch_rss

    with console.status(f"Fetching RSS for {username}..."):
        entries = fetch_rss(username)

    table = Table(title=f"Recent activity — {username}", show_header=True)
    table.add_column("Date")
    table.add_column("Film")
    table.add_column("Year")
    table.add_column("Rating", justify="center")
    table.add_column("Rewatch", justify="center")

    for entry in entries[:limit]:
        rating_str = ""
        if entry.rating:
            stars = int(entry.rating)
            half = "½" if entry.rating % 1 else ""
            rating_str = "★" * stars + half
        table.add_row(
            entry.watch_date or "—",
            entry.film_title,
            str(entry.film_year or "—"),
            rating_str,
            "↻" if entry.is_rewatch else "",
        )
    console.print(table)


@app.command()
def match(
    username: str = typer.Argument(help="Your Letterboxd username"),
    others: list[str] = typer.Argument(help="Usernames to compare against"),
):
    """Compare your taste against specific Letterboxd users.

    Example: loverboxd match myuser friend1 friend2 friend3
    """
    from .match import find_matches_from_followers

    with console.status(f"Comparing {username} against {len(others)} users..."):
        matches = find_matches_from_followers(username, others)

    if not matches:
        console.print("[yellow]No overlapping rated films found.[/yellow]")
        raise typer.Exit()

    _print_matches(f"Taste comparison for {username}", matches)


@app.command()
def discover(
    username: str = typer.Argument(help="Your Letterboxd username"),
    max_films: int = typer.Option(15, help="Number of top films to use as probes"),
    min_overlap: int = typer.Option(3, help="Minimum shared films to be a match"),
    max_pages: int = typer.Option(10, help="Max pages of rated films to scrape"),
):
    """Discover strangers with similar taste by scanning film member pages.

    This scrapes your rated films, then checks who else rated your favorites
    highly. Slower but finds people outside your network.
    """
    from .scraper import get_rated_films
    from .match import discover_similar_users, DiscoveryConfig

    with console.status(f"Scraping rated films for {username}..."):
        films = get_rated_films(username, max_pages=max_pages)

    if not films:
        console.print("[red]No rated films found. Make sure the profile is public.[/red]")
        raise typer.Exit(1)

    rated = [f for f in films if f.rating]
    console.print(f"Found {len(rated)} rated films. Scanning for similar users...")

    config = DiscoveryConfig(max_films_to_sample=max_films, min_overlap=min_overlap)
    with console.status("Scanning film member pages (this may take a few minutes)..."):
        matches = discover_similar_users(films, config)

    if not matches:
        console.print("[yellow]No strong matches found. Try --max-films to increase probe count.[/yellow]")
        raise typer.Exit()

    _print_matches(f"Users similar to {username}", matches)


@app.command()
def film(
    slug: str = typer.Argument(help="Film slug (e.g. 'parasite-2019')"),
):
    """Show details for a film."""
    from .scraper import get_film_details

    with console.status(f"Fetching film: {slug}..."):
        f = get_film_details(slug)

    console.print(f"\n[bold]{f.title}[/bold] ({f.year or '?'})")
    if f.director:
        console.print(f"  Director: {f.director}")
    if f.average_rating:
        console.print(f"  Average rating: {'★' * int(f.average_rating)}{'½' if f.average_rating % 1 >= 0.25 else ''} ({f.average_rating})")
    if f.genres:
        console.print(f"  Genres: {', '.join(f.genres)}")
    if f.runtime:
        console.print(f"  Runtime: {f.runtime} min")
    if f.synopsis:
        console.print(f"  {f.synopsis[:200]}")


@app.command()
def search(
    query: str = typer.Argument(help="Search query"),
    type: str = typer.Option("film", help="Type: 'film' or 'member'"),
):
    """Search for films or members via the Letterboxd API."""
    from .api import search_films, search_members

    if type == "member":
        with console.status("Searching members..."):
            results, _ = search_members(query)
        for m in results:
            status = f" [{m.member_status}]" if m.member_status else ""
            console.print(f"  @{m.username} — {m.display_name}{status}")
    else:
        with console.status("Searching films..."):
            results, _ = search_films(query)
        for f in results:
            rating = f"★{f.rating:.1f}" if f.rating else ""
            dirs = f" — {', '.join(f.directors)}" if f.directors else ""
            top = f" [Top 250 #{f.top250_position}]" if f.top250_position else ""
            console.print(f"  {f.name} ({f.release_year or '?'}) {rating}{dirs}{top}")


@app.command(name="import")
def import_csv(
    path: str = typer.Argument(help="Path to Letterboxd export ZIP or CSV"),
):
    """Import and show stats from a Letterboxd CSV export."""
    from .csv_import import load_export, parse_ratings, parse_diary
    from .stats import from_csv, compute_stats

    p = Path(path)
    if not p.exists():
        console.print(f"[red]File not found: {path}[/red]")
        raise typer.Exit(1)

    data = load_export(p)
    console.print(f"Loaded {len(data)} file(s): {', '.join(data.keys())}")

    all_films = []
    for name, rows in data.items():
        console.print(f"\n[bold]{name}[/bold]: {len(rows)} entries")
        if "rating" in name.lower():
            films = parse_ratings(rows)
            all_films = from_csv(films)
            rated = [f for f in films if f.rating]
            if rated:
                avg = sum(f.rating for f in rated) / len(rated)
                console.print(f"  Average rating: {avg:.2f}  |  Total rated: {len(rated)}")
        elif "diary" in name.lower():
            entries = parse_diary(rows)
            if not all_films:
                all_films = from_csv(entries)
            rewatches = sum(1 for e in entries if e.is_rewatch)
            console.print(f"  Entries: {len(entries)}  |  Rewatches: {rewatches}")

    if all_films:
        s = compute_stats("import", all_films)
        console.print(f"\n[bold]Full Stats[/bold]")
        console.print(f"  Total: {s.total_films}  |  Rated: {s.total_rated}  |  Avg: {s.average_rating}")
        if s.rating_distribution:
            table = Table(title="Rating Distribution", show_header=True)
            table.add_column("Stars", style="yellow")
            table.add_column("Count", justify="right")
            for rating, count in s.rating_distribution.items():
                stars = int(rating)
                half = "½" if rating % 1 else ""
                table.add_row(f"{'★' * stars}{half}", str(count))
            console.print(table)


def _print_matches(title: str, matches: list) -> None:
    table = Table(title=title, show_header=True)
    table.add_column("User")
    table.add_column("Score", justify="right")
    table.add_column("Shared", justify="right")
    table.add_column("Avg Diff", justify="right")
    table.add_column("Shared Films")

    for m in matches[:25]:
        table.add_row(
            f"[link=https://letterboxd.com/{m.username}]{m.username}[/link]",
            f"{m.similarity_score}%",
            str(m.overlap_count),
            f"±{m.rating_agreement}★",
            ", ".join(m.shared_films[:3]),
        )
    console.print(table)


if __name__ == "__main__":
    app()
