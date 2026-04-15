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

// Key stealth patches — applied via evaluateOnNewDocument before any page JS runs.
// These cover the main signals Cloudflare checks without needing puppeteer-extra.
const STEALTH_SCRIPTS = [
  // 1. Remove navigator.webdriver flag
  `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`,

  // 2. Fake chrome.runtime so the page sees a real Chrome environment
  `window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };`,

  // 3. Fix permissions query for notifications
  `const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
   window.navigator.permissions.query = (params) =>
     params.name === 'notifications'
       ? Promise.resolve({ state: Notification.permission })
       : origQuery(params);`,

  // 4. Spoof plugins (headless Chrome has none)
  `Object.defineProperty(navigator, 'plugins', {
     get: () => [1, 2, 3, 4, 5].map(() => ({
       0: { type: 'application/pdf' },
       length: 1,
       description: 'Portable Document Format',
       filename: 'internal-pdf-viewer',
       name: 'Chrome PDF Plugin'
     }))
   });`,

  // 5. Spoof languages
  `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });`,

  // 6. Fix broken iframe contentWindow in headless
  `const origAttachShadow = Element.prototype.attachShadow;
   Element.prototype.attachShadow = function() {
     return origAttachShadow.apply(this, arguments);
   };`,
];

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

  // Dynamic imports to keep cold starts fast
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = await import("puppeteer-core");

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
    headless: "shell",
  });

  try {
    const page = await browser.newPage();

    // Apply stealth patches before any page JS executes
    for (const script of STEALTH_SCRIPTS) {
      await page.evaluateOnNewDocument(script);
    }

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
