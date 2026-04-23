# loverboxd-scraper-worker

Thin Cloudflare Worker that proxies Letterboxd HTML page fetches for the Vercel-hosted Next.js app. Needed because Letterboxd's Cloudflare WAF challenges requests from Vercel's AWS IPs, returning 403 "Just a moment…" on ratings/likes/films grid pages. Requests originating from Cloudflare's own edge network bypass those challenges.

## Architecture

```
Browser → Vercel (Next.js /api/stats) → This Worker → letterboxd.com
                                          ↑
                                    CF's own network
```

The Next.js app in `web/` checks for the `SCRAPER_WORKER_URL` and `SCRAPER_WORKER_SECRET` env vars. When both are set, scrape requests route through this Worker. When unset (e.g. local dev), they hit Letterboxd directly.

## One-time deploy

```bash
cd worker
npm install
npx wrangler login               # opens browser; authorize CF account
npx wrangler secret put SCRAPER_SECRET
# ↑ paste a long random string — save it, you'll need it in Vercel too
npx wrangler deploy
```

Wrangler prints the Worker URL, e.g. `https://loverboxd-scraper.<subdomain>.workers.dev`. Add both values to Vercel:

1. Vercel project → Settings → Environment Variables
2. `SCRAPER_WORKER_URL` = `https://loverboxd-scraper.<subdomain>.workers.dev` (no trailing slash)
3. `SCRAPER_WORKER_SECRET` = the random string from the `wrangler secret put` step
4. Redeploy the Next.js app so it picks up the new env vars

## Endpoint

`GET /fetch?path=/username/films/ratings/page/1/`

Headers:
- `Authorization: Bearer <SCRAPER_SECRET>` (required)
- `Cookie: <name=value; name=value>` (optional — passes through to Letterboxd)

Response:
- Status: mirrors Letterboxd
- Body: raw response (HTML/XML/JSON)
- `X-Set-Cookies`: base64(JSON.stringify(string[])) of any Set-Cookie values — the caller appends these to its cookie jar for subsequent page fetches

Only paths starting with `/` are accepted; the Worker pins the host to `letterboxd.com`. There is no open-proxy mode.

## Local dev

```bash
npx wrangler dev
# Serves on http://localhost:8787
```

Set the secret for local dev by creating `.dev.vars`:

```
SCRAPER_SECRET=some-dev-string
```

## Observability

`npx wrangler tail` streams live logs. Also viewable in the CF dashboard → Workers → loverboxd-scraper → Logs. Errors in the upstream fetch come back as 502 with a short message in the body.
