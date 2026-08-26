// Web search module with a provider fallback loop, ending at free DuckDuckGo.
// Order: Tavily -> Serper (Google) -> Exa -> Firecrawl -> DuckDuckGo (last resort).
// Any missing key is skipped; the first provider that returns results wins.

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function formatResults(list, max = 5) {
  const arr = Array.isArray(list) ? list : [];
  return arr.slice(0, max).map((r, i) => {
    const title = r.title || "Untitled";
    const snippet = (r.snippet || r.content || r.text || r.description || "").replace(/\s+/g, " ").slice(0, 280);
    const url = r.url || r.link || "";
    return `${i + 1}. ${title} — ${snippet} (${url})`;
  }).join("\n");
}

// ── Tavily ───────────────────────────────────────────────────────────────────
async function searchTavily(query, key) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, search_depth: "basic", max_results: 5 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return formatResults((data.results || []).map((r) => ({ title: r.title, snippet: r.content, url: r.url })));
}

// ── Serper (Google) ──────────────────────────────────────────────────────────
async function searchSerper(query, key) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = (data.organic || []).map((r) => ({ title: r.title, snippet: r.snippet, url: r.link }));
  if (data.answerBox && (data.answerBox.answer || data.answerBox.snippet)) {
    list.unshift({ title: "Google Answer", snippet: data.answerBox.answer || data.answerBox.snippet, url: data.answerBox.link || "" });
  }
  return formatResults(list);
}

// ── Exa ──────────────────────────────────────────────────────────────────────
async function searchExa(query, key) {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, numResults: 5, contents: { text: true } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return formatResults((data.results || []).map((r) => ({ title: r.title, snippet: (r.text || "").slice(0, 300), url: r.url })));
}

// ── Firecrawl ────────────────────────────────────────────────────────────────
async function searchFirecrawl(query, key) {
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 5 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return formatResults((data.data || []).map((r) => ({ title: r.title, snippet: r.description, url: r.url })));
}

// ── DuckDuckGo (free, last resort) ───────────────────────────────────────────
async function searchDuckDuckGo(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const items = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null && items.length < 5) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    items.push({ title: m[2].replace(/<[^>]+>/g, ""), snippet: m[3].replace(/<[^>]+>/g, ""), url });
  }
  if (!items.length) throw new Error("no results parsed");
  return formatResults(items);
}

// ── Provider list (fallback order; Tavily last among keyed APIs since its key was 401) ──
// ── Grokipedia (free, NO key) — xAI / Elon Musk's AI encyclopedia ─────────────
// Search: /search?q= (server-rendered HTML -> /page/{slug} links)
// Article: /page/{slug} (full article; body lives inside <article>)
async function searchGrokipedia(query) {
  const q = encodeURIComponent(query);
  let html = "";
  let ok = false;
  // Grokipedia intermittently serves the results-less shell — retry a few times
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const res = await fetch(`https://grokipedia.com/search?q=${q}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    html = await res.text();
    if (html.includes("/page/")) ok = true;
    else await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  const slugs = [...new Set([
    ...[...html.matchAll(/href="\/page\/([^"#?]+)"/g)].map((m) => decodeURIComponent(m[1])),
    ...[...html.matchAll(/data-page-slug="([^"]+)"/g)].map((m) => decodeURIComponent(m[1])),
  ])];
  const bad = /^(search|login|sign|contribute|suggest|api|stats|terms|privacy|about|random|sitemap|random_article)$/i;
  const good = slugs.filter((s) => s && !bad.test(s)).slice(0, 3);
  if (!good.length) throw new Error("no article links");
  const lines = [];
  for (const slug of good) {
    try {
      const a = await fetch(`https://grokipedia.com/page/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(20000) });
      if (!a.ok) continue;
      const ah = await a.text();
      const title = ((ah.match(/<title>([^<]*)<\/title>/) || [])[1] || slug).replace(/\s*[—|]\s*Grokipedia\s*$/i, "").trim();
      const body = extractGrokiBody(ah).slice(0, 600);
      if (body) lines.push(`${title}: ${body} (https://grokipedia.com/page/${encodeURIComponent(slug)})`);
    } catch {}
  }
  if (!lines.length) throw new Error("no article bodies");
  return lines.join("\n");
}

function extractGrokiBody(html) {
  let body = html;
  const a = html.indexOf("<article");
  const aEnd = html.indexOf("</article>");
  if (a >= 0 && aEnd > a) body = html.slice(a, aEnd);
  else {
    const m = html.indexOf("<main");
    const mEnd = html.indexOf("</main>");
    if (m >= 0 && mEnd > m) body = html.slice(m, mEnd);
  }
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

// ── Wikipedia (free, NO key) — high-quality factual grounding (history/Bible) ──
async function searchWikipedia(query) {
  const q = encodeURIComponent(query);
  const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&srlimit=4&utf8=1`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const hits = (d.query?.search || []).map((s) => s.title).filter(Boolean);
  if (!hits.length) return "";
  const lines = [];
  for (const title of hits.slice(0, 3)) {
    try {
      const s = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!s.ok) continue;
      const j = await s.json();
      const extract = (j.extract || "").replace(/\s+/g, " ").slice(0, 400);
      if (extract) lines.push(`${j.title || title}: ${extract} (en.wikipedia.org/wiki/${encodeURIComponent(title)})`);
    } catch {}
  }
  if (!lines.length) throw new Error("no wiki summaries");
  return lines.join("\n");
}

// ── SearXNG public instances (free open-source meta-search, NO key) ──
const SEARX_INSTANCES = [
  "https://searx.be",
  "https://search.bus-hit.me",
  "https://searx.tiekoetter.com",
  "https://priv.au",
];
async function searchSearx(query) {
  let last;
  for (const base of SEARX_INSTANCES) {
    try {
      const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { last = new Error(`HTTP ${res.status} from ${base}`); continue; }
      const d = await res.json();
      const list = (d.results || []).slice(0, 5)
        .filter((r) => r.title && r.url)
        .map((r) => `${r.title} — ${(r.content || "").replace(/\s+/g, " ").slice(0, 250)} (${r.url})`);
      if (list.length) return list.join("\n");
      last = new Error(`empty from ${base}`);
    } catch (e) { last = e; }
  }
  throw last || new Error("all searx instances failed");
}

const PROVIDERS = [
  { name: "Grokipedia", run: searchGrokipedia, key: () => "free" },         // xAI encyclopedia, no key
  { name: "Wikipedia", run: searchWikipedia, key: () => "free" },           // no key needed
  { name: "SearXNG", run: searchSearx, key: () => "free" },                 // no key needed
  { name: "Serper", run: searchSerper, key: () => process.env.SERPER_API_KEY },
  { name: "Exa", run: searchExa, key: () => process.env.EXA_API_KEY },
  { name: "Firecrawl", run: searchFirecrawl, key: () => process.env.FIRECRAWL_API_KEY },
  { name: "Tavily", run: searchTavily, key: () => process.env.TAVILY_API_KEY },
];

async function searchWeb(query, maxWaitMs = 8000) {
  const errors = [];
  for (const p of PROVIDERS) {
    const k = p.key();
    if (!k) { errors.push(`${p.name}: no key`); continue; }
    try {
      const text = await withTimeout(p.run(query, k), maxWaitMs, p.name);
      if (text && text.trim()) {
        console.log(`[WebSearch] ${p.name} returned results`);
        return { provider: p.name, results: text };
      }
      errors.push(`${p.name}: empty`);
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
      console.warn(`[WebSearch] ${p.name} failed: ${e.message}`);
    }
  }
  // DuckDuckGo — always available, no key needed.
  try {
    const text = await withTimeout(searchDuckDuckGo(query), maxWaitMs, "DuckDuckGo");
    if (text && text.trim()) {
      console.log("[WebSearch] DuckDuckGo returned results");
      return { provider: "DuckDuckGo", results: text };
    }
    errors.push("DuckDuckGo: empty");
  } catch (e) {
    errors.push(`DuckDuckGo: ${e.message}`);
    console.warn(`[WebSearch] DuckDuckGo failed: ${e.message}`);
  }
  console.warn("[WebSearch] All providers failed:", errors.join(" | "));
  return null;
}

// Heuristic: is this chat message likely a current/factual question needing the web?
function looksLikeSearchQuery(text) {
  const t = (text || "").trim().toLowerCase();
  if (t.length < 12) return false;
  const fresh = /\b(latest|newest|current|today|now|news|released|release|update|recent|happened|announced|launch|new|202[4-9])\b/.test(t);
  const fact = /\b(who|what|when|where|why|how|is|are|was|were|did|does|best|top|price|cost|model|explain)\b/.test(t);
  const q = /\?/.test(t);
  return (fresh && fact) || (q && fact) || fresh;
}

module.exports = { searchWeb, looksLikeSearchQuery, searchTavily, searchSerper, searchExa, searchFirecrawl, searchWikipedia, searchSearx, searchGrokipedia };
