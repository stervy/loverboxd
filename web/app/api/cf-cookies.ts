/**
 * Cloudflare cookie harvesting via headless Chrome.
 *
 * Launches a real browser to solve Cloudflare's JS challenge,
 * extracts the cf_clearance cookie, and caches it in memory.
 * Subsequent fetches reuse the cookie until it expires.
 */

let cachedSession: {
  cookies: string[];
  userAgent: string;
  expiresAt: number;
} | null = null;

const CF_COOKIE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Returns Cloudflare cookies + the matching User-Agent.
 * Launches headless Chrome only when the cache is empty/expired.
 */
export async function getCFCookies(): Promise<{
  cookies: string[];
  userAgent: string;
}> {
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return {
      cookies: cachedSession.cookies,
      userAgent: cachedSession.userAgent,
    };
  }

  // Dynamic imports — keeps cold starts fast for routes that don't need Puppeteer
  const chromium = (await import("@sparticuz/chromium")).default;
  const { addExtra } = await import("puppeteer-extra");
  const puppeteerCore = await import("puppeteer-core");
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth"))
    .default;

  const puppeteer = addExtra(puppeteerCore as unknown as Parameters<typeof addExtra>[0]);
  puppeteer.use(StealthPlugin());

  // Disable GPU/WebGL for serverless
  chromium.setGraphicsMode = false;

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    defaultViewport: { width: 1920, height: 1080 },
    executablePath: await chromium.executablePath(),
    headless: "shell", // "shell" (old headless) is less detectable than true/"new"
  });

  try {
    const page = await browser.newPage();

    // Navigate to letterboxd homepage — lightest page to solve CF challenge
    await page.goto("https://letterboxd.com/", {
      waitUntil: "networkidle0",
      timeout: 25000,
    });

    // Wait for CF challenge to resolve (title changes from "Just a moment...")
    await page.waitForFunction(
      () => !document.title.includes("Just a moment"),
      { timeout: 20000 }
    );

    // Extract cookies and User-Agent
    const browserCookies = await page.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);

    const cookieStrings = browserCookies.map(
      (c: { name: string; value: string }) => `${c.name}=${c.value}`
    );

    cachedSession = {
      cookies: cookieStrings,
      userAgent,
      expiresAt: Date.now() + CF_COOKIE_TTL,
    };

    return { cookies: cookieStrings, userAgent };
  } finally {
    await browser.close();
  }
}

/**
 * Invalidate the cached cookies (e.g. when a fetch still gets blocked).
 */
export function invalidateCFCookies(): void {
  cachedSession = null;
}
