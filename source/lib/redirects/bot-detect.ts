/**
 * Best-effort bot detection by User-Agent substring match.
 *
 * Used by the redirect telemetry paths (the proxy for external destinations
 * and `/api/redirects/hit/[id]` for internal destinations) to suppress
 * hit-count inflation from search engine crawlers, link-preview bots, and
 * uptime monitors.
 *
 * NOT a security boundary. Sophisticated scrapers can spoof a browser UA
 * and will not be blocked. The goal is to filter the loud, well-behaved
 * majority — Googlebot, Bingbot, FacebookExternalHit, UptimeRobot, etc.
 */

const BOT_UA_PATTERNS: readonly string[] = [
  // Search engines
  "googlebot",
  "bingbot",
  "slurp", // Yahoo
  "duckduckbot",
  "duckduckgo",
  "baiduspider",
  "yandexbot",
  "yandeximages",
  "sogou",
  "exabot",
  "facebot",
  "ia_archiver",
  "applebot",
  "petalbot",

  // SEO / scraping crawlers
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "rogerbot",
  "screaming frog",
  "sitebulb",

  // Link previewers / messaging unfurl
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "slackbot",
  "discordbot",
  "skypeuripreview",
  "embedly",
  "redditbot",
  "pinterestbot",

  // Uptime / monitoring
  "uptimerobot",
  "pingdom",
  "statuscake",
  "site24x7",
  "newrelicpinger",
  "datadog",
  "betteruptime",
  "better uptime",

  // Headless / automation (catches naive scrapers)
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  "chrome-lighthouse",
  "lighthouse",
  "pagespeed",

  // Generic crawler tells
  "crawler",
  "spider",
  "scraper",
  "bot/", // matches "Foo bot/1.0" without matching "/about" etc
];

/**
 * Returns true if the User-Agent looks like a bot, link previewer, or
 * uptime monitor. Returns true for null/empty UAs as well — a request
 * with no UA is more likely to be a script than a real browser, and the
 * cost of a false positive (one missed hit) is far lower than a false
 * negative (inflated counts).
 *
 * The check is case-insensitive substring match against a denylist.
 * `curl/`, `wget/`, and `python-requests/` are intentionally NOT in the
 * denylist — those are the manual-smoke-test paths and we want them to
 * count as real hits during verification.
 */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  for (const pattern of BOT_UA_PATTERNS) {
    if (ua.includes(pattern)) return true;
  }
  return false;
}
