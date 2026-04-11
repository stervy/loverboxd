# loverboxd

Unofficial Letterboxd stats & user-matching toolkit. Since Letterboxd's official API requires approval (and they're not responding), this project reverse-engineers their web interface and API to give you:

- **Profile stats** — ratings distribution, average rating, films by decade, favorites
- **Full rated-film scraping** — paginated scraping of all your rated films
- **Recent activity** — via RSS feeds (structured XML, no scraping needed)
- **Taste matching** — compare your ratings against friends or discover strangers with similar taste
- **Film search** — via the unauthenticated Letterboxd API (`api.letterboxd.com/api/v0/search`)
- **Film details** — director, genres, runtime, average rating, synopsis
- **CSV import** — analyze your full Letterboxd data export offline

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Usage

### Get stats for a user
```bash
loverboxd stats <username>           # quick stats from RSS (~100 entries)
loverboxd stats <username> --full    # full stats from all rated films
```

### View recent activity
```bash
loverboxd feed <username>
```

### Compare taste against specific users
```bash
loverboxd match <you> <friend1> <friend2> <friend3>
```

### Discover similar users (scans film member pages)
```bash
loverboxd discover <username>
```

### Search for films or members
```bash
loverboxd search "parasite"
loverboxd search "dave" --type member
```

### Look up a film
```bash
loverboxd film parasite-2019
```

### Import a Letterboxd CSV export
```bash
loverboxd import ~/Downloads/letterboxd-export.zip
```

## How it works

### Reverse-engineering discoveries

1. **`X-Requested-With: XMLHttpRequest`** header + session cookies bypass Cloudflare protection on all Letterboxd pages (profile, ratings, diary, following, film members, etc.)

2. **`api.letterboxd.com/api/v0/search`** works without authentication and returns rich JSON including film ratings, poster URLs, Top 250 positions, directors, and member profiles

3. **Session warmup** — hitting a profile page first establishes Cloudflare cookies, making all subsequent requests in the same session succeed

### Data sources

| Source | Method | What you get |
|---|---|---|
| Profile page | HTML scrape | Watch count, followers, favorites, bio |
| Ratings pages | HTML scrape (paginated) | All rated films with star ratings |
| Diary pages | HTML scrape (paginated) | Watch dates, rewatches, ratings |
| Film pages | HTML scrape | Title, director, genres, runtime, avg rating |
| Film member pages | HTML scrape | Who rated each film and how |
| Following/followers | HTML scrape | Usernames |
| RSS feed | XML parse | ~100 recent entries with ratings, dates |
| API v0 search | JSON API (no auth) | Film/member search with rich metadata |
| CSV export | Local ZIP/CSV | Complete history from user's own export |

## Python API

```python
from loverboxd.scraper import (
    get_profile, get_rated_films, get_diary, get_film_details,
    get_following, get_followers, get_film_fans, get_watched_film_slugs,
)
from loverboxd.rss import fetch_rss
from loverboxd.api import search_films, search_members
from loverboxd.stats import compute_stats, from_rss
from loverboxd.match import compare_users, discover_similar_users, find_matches_from_rss

# Profile
profile = get_profile("username")

# All rated films (full scrape)
films = get_rated_films("username")

# Recent activity
entries = fetch_rss("username")
stats = compute_stats("username", from_rss(entries))

# Search (no auth needed)
results, next_cursor = search_films("parasite")
members, _ = search_members("dave")

# Discover similar users
similar = discover_similar_users(films)

# Who rated a specific film
fans = get_film_fans("parasite-2019")  # {username: rating}
```

## Disclaimer

This tool accesses publicly available data from Letterboxd. Please use responsibly — add delays between bulk requests and cache results where possible.
