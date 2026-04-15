/**
 * Shared fetch wrapper that injects Cloudflare cookies.
 *
 * All routes that fetch from letterboxd.com should use this
 * instead of raw fetch() to automatically handle CF challenges.
 */

import { getCFCookies, invalidateCFCookies } from "./cf-cookies";

const BASE_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua-mobile": "?0",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  Referer: "https://letterboxd.com/",
};

/**
 * Fetch a letterboxd.com URL with Cloudflare cookies injected.
 * Retries once with fresh cookies if the first attempt is still blocked.
 */
export async function cfFetch(url: string): Promise<string> {
  const html = await doFetch(url);

  // If CF still challenged us, invalidate cookies and retry once
  if (html.includes("Just a moment")) {
    invalidateCFCookies();
    return doFetch(url);
  }

  return html;
}

async function doFetch(url: string): Promise<string> {
  const { cookies, userAgent } = await getCFCookies();
  const resp = await fetch(url, {
    headers: {
      ...BASE_HEADERS,
      "User-Agent": userAgent,
      Cookie: cookies.join("; "),
    },
    redirect: "follow",
  });
  return resp.text();
}
