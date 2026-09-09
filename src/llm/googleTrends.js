// src/llm/googleTrends.js
// Minimal, dependency-free Google Trends client (no API key, no external lib).
//
// Endpoint: https://trends.google.com/trending/rss?geo=XX  — Google's public
// "Daily Search Trends" RSS feed. Gives a snapshot of what people are actually
// searching right now per region (US/NG/GB...). We use it as an INSPIRATION /
// "human pulse" layer: the V10 script picks its psychological angle from it and
// the Shorts seed fresh vocabulary from it — never as a hard directive.
//
// Rules:
//   - BEST EFFORT ONLY: any failure returns [] so no pipeline ever breaks on
//     Google being unreachable/rate-limited.
//   - CACHED (~3h) so the daily build does not hammer the feed.
//   - No scraping of autocomplete/cookies — just the public RSS.
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..");
const CACHE_FILE = path.join(BASE, "temp_media", "google_trends_cache.json");
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const RSS_URL = "https://trends.google.com/trending/rss";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (c && c.at && Date.now() - c.at < CACHE_TTL_MS && Array.isArray(c.terms)) return c.terms;
  } catch { /* first run / corrupt */ }
  return null;
}
function writeCache(terms) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), terms }, null, 1)); } catch {}
}

function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .trim();
}

// Split the RSS into <item>...</item> blocks and pull each item's <title>.
function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    const t = decodeXml((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const clean = t.replace(/\s+/g, " ").trim();
    if (!clean || clean.toLowerCase() === "daily search trends") continue;
    // Keep terms a spark-writer can actually use: drop heavy non-Latin runs
    // (CJK/Greek/Cyrillic) while keeping accented Latin + digits.
    const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, "").length || 1;
    const nonAscii = clean.replace(/[\x00-\x7F]/g, "").length;
    if (nonAscii / letters > 0.25) continue;
    items.push(clean);
  }
  return items;
}

async function fetchGeo(geo) {
  const url = `${RSS_URL}?geo=${encodeURIComponent(geo)}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, text/xml, */*" }, signal: ctrl.signal });
    if (!r.ok) { console.warn(`[googleTrends] geo=${geo} HTTP ${r.status}`); return []; }
    const xml = await r.text();
    const terms = parseRss(xml);
    return terms.slice(0, 25);
  } catch (e) {
    console.warn(`[googleTrends] geo=${geo} failed:`, e.message);
    return [];
  } finally {
    clearTimeout(to);
  }
}

// Combined today's searches across several geos, deduped, order preserved.
async function getTrending({ geos = ["US", "NG", "GB"], maxPerGeo = 15, maxTotal = 35, force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached && cached.length) return cached.slice(0, maxTotal);
  }
  const settled = await Promise.allSettled(geos.map((g) => fetchGeo(g)));
  const seen = new Set();
  const out = [];
  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    for (const term of res.value.slice(0, maxPerGeo)) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
      if (out.length >= maxTotal) break;
    }
    if (out.length >= maxTotal) break;
  }
  if (out.length) writeCache(out);
  return out;
}

// Alias used by script generators: plain list of strings (cached).
async function trendingTerms(opts) {
  return getTrending(opts);
}

module.exports = { getTrending, trendingTerms, fetchGeo, parseRss };

if (require.main === module) {
  (async () => {
    const terms = await getTrending({ force: true });
    console.log("trending terms:", JSON.stringify(terms, null, 1));
  })();
}
