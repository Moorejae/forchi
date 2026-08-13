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
const PROVIDERS = [
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

module.exports = { searchWeb, looksLikeSearchQuery, searchTavily, searchSerper, searchExa, searchFirecrawl };
