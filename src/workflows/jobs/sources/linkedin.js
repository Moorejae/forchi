// LinkedIn job discovery via LinkedIn's PUBLIC guest jobs endpoint — no API
// key, no login. This is the same unauthenticated JSON endpoint that powers the
// public linkedin.com/jobs search page (f_WT=2 = remote-only).
//
// The response is HTML cards, each carrying: jobPosting id, view URL, title,
// company, location, and posted date. We then fetch a few posting pages for
// their description so the matcher can score properly.
//
// AUTO-APPLY UPGRADE: LinkedIn hides the external ATS apply URL from the public
// page (Easy Apply is not scriptable), BUT many LinkedIn postings also live on
// the company's Greenhouse/Lever/Ashby/Workable board. For each new LinkedIn
// job we web-search for that ATS posting; if found, the job is REWRITTEN to the
// ATS source and auto-applied by the existing engine. Only jobs with no
// discoverable ATS posting (incl. Easy Apply) stay semi-auto (email).
const { searchWeb } = require("../../../llm/webSearch");
const { guessCompanyUrl } = require("./ats");

// User's LinkedIn search recipe (STRICT — USER DIRECTIVE 2026-09-01): only
// INTERNSHIP / JUNIOR / ENTRY-LEVEL roles under cloud security, DevOps / SRE,
// AI integration, workflow automation, or API integration. Each query combines
// a LEVEL word with a DOMAIN word so only on-target entry-level roles come back.
// Remote.
const KEYWORDS = [
  // Cloud Security
  "cloud security intern",
  "cloud security junior",
  "security engineer intern",
  "security analyst junior",
  // DevOps / SRE / Platform (USER ADD 2026-09-01)
  "devops intern",
  "devops junior",
  "devops engineer intern",
  "cloud engineer intern",
  "site reliability engineer junior",
  "platform engineer intern",
  "kubernetes intern",
  // AI Integration
  "AI integration intern",
  "AI integration junior",
  "AI engineer intern",
  "AI engineer junior",
  "LLM intern",
  "machine learning intern",
  "AI automation junior",
  // Workflow Automation
  "workflow automation intern",
  "automation engineer intern",
  "automation engineer junior",
  "RPA junior",
  // API Integration
  "API integration intern",
  "API integration junior",
  "integration engineer junior",
  "backend developer intern",
  "backend developer junior",
  "API developer junior",
];
const MAX_CARDS = 40; // cards parsed per scan
const MAX_DESC_FETCH = 10; // posting pages to fetch for description
const ATS_SEARCH_MAX = 15; // jobs per scan we web-search for an ATS posting

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Parse the HTML job cards from the guest endpoint.
function parseCards(html) {
  const cards = [];
  const re = /<li>[\s\S]*?<\/li>/g;
  let m;
  while ((m = re.exec(html || "")) !== null) {
    const block = m[0];
    const id = (block.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/) || [])[1];
    const href = (block.match(/base-card__full-link[^>]*href="([^"]+)"/) || [])[1];
    const title = stripTags((block.match(/base-search-card__title">([\s\S]*?)<\/h3>/) || [])[1]);
    const company = stripTags((block.match(/base-search-card__subtitle">([\s\S]*?)<\/h4>/) || [])[1]);
    const location = stripTags((block.match(/job-search-card__location">([\s\S]*?)<\/span>/) || [])[1]);
    // The date element uses class "job-search-card__listdate" normally and
    // "job-search-card__listdate--new" under the f_TPR (time) filter.
    const postedAt = (block.match(/job-search-card__listdate[^"]*" datetime="([^"]+)"/) || [])[1];
    if (!id || !title) continue;
    const cleanUrl = `https://www.linkedin.com/jobs/view/${id}`;
    cards.push({ id, url: cleanUrl, title, company: company || "LinkedIn", location: location || "Remote", postedAt: postedAt || null });
  }
  return cards;
}

// Fetch description from a posting page (og:description / JSON-LD, best-effort).
async function fetchDescription(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    const html = await res.text();
    const og = (p) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, "i")) ||
               html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${p}["']`, "i"));
      return m ? m[1].replace(/&amp;/g, "&").trim() : "";
    };
    const desc = og("og:description");
    if (desc) return desc;
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const b of ld) {
      try {
        const d = JSON.parse(b.replace(/<\/?script[^>]*>/g, ""));
        if (String(d["@type"] || "").includes("JobPosting") && d.description) return String(d.description).replace(/<[^>]+>/g, " ").trim();
      } catch { /* skip */ }
    }
    return "";
  } catch (e) {
    console.warn(`[Jobs] LinkedIn desc fetch skipped (${e.message})`);
    return "";
  }
}

// Primary: LinkedIn guest jobs search endpoint (public).
// Filters: f_WT=2 (remote) · f_TPR=r86400 (posted in the past 24h) ·
//          f_AL=true (under 10 applicants).
async function fetchLinkedInGuest() {
  const seen = new Map(); // id -> card
  for (const kw of KEYWORDS) {
    if (seen.size >= MAX_CARDS) break;
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&location=Remote&f_WT=2&f_TPR=r86400&f_AL=true&start=0`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
      if (!res.ok) { console.warn(`[Jobs] LinkedIn guest ${kw}: HTTP ${res.status}`); continue; }
      const cards = parseCards(await res.text());
      for (const c of cards) if (!seen.has(c.id)) seen.set(c.id, c);
    } catch (e) {
      console.warn(`[Jobs] LinkedIn guest ${kw} skipped (${e.message})`);
    }
  }
  return [...seen.values()];
}

// Fetch a posting page's title/company/description (JSON-LD preferred, then og).
async function fetchCardMeta(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    const og = (p) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, "i")) ||
               html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${p}["']`, "i"));
      return m ? m[1].replace(/&amp;/g, "&").trim() : "";
    };
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const b of ld) {
      try {
        const d = JSON.parse(b.replace(/<\/?script[^>]*>/g, ""));
        if (String(d["@type"] || "").includes("JobPosting")) {
          return {
            title: String(d.title || "").trim(),
            company: (d.hiringOrganization && d.hiringOrganization.name) || "",
            description: String(d.description || "").replace(/<[^>]+>/g, " ").trim(),
          };
        }
      } catch { /* skip */ }
    }
    const ogTitle = og("og:title").replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
    const parts = ogTitle.split(/\s+[–—-]\s+/).filter(Boolean);
    return {
      title: parts[0] || ogTitle,
      company: parts.length >= 2 ? parts[parts.length - 1] : "",
      description: og("og:description"),
    };
  } catch (e) {
    console.warn(`[Jobs] LinkedIn meta fetch skipped (${e.message})`);
    return null;
  }
}

// Fallback: web search for job-view URLs (used only if the guest endpoint dies).
async function fetchLinkedInViaSearch() {
  const urls = new Set();
  const QUERIES = KEYWORDS.map((k) => `site:linkedin.com/jobs "${k}" remote`);
  for (const q of QUERIES) {
    if (urls.size >= 15) break;
    try {
      const r = await searchWeb(q, 6000);
      const re = /\((https?:\/\/[^)\s]+)\)/g;
      let m;
      while ((m = re.exec((r && r.results) || "")) !== null) {
        const u = m[1].replace(/[.,;:]+$/, "");
        if (/linkedin\.com\/jobs\/view\//.test(u)) {
          const idm = u.match(/(\d+)$/);
          if (idm) urls.add(`https://www.linkedin.com/jobs/view/${idm[1]}`);
        }
      }
    } catch (e) { /* skip */ }
  }
  const list = [...urls].slice(0, 15);
  const metas = await Promise.all(list.map((u) => fetchCardMeta(u)));
  const cards = [];
  for (let i = 0; i < list.length; i++) {
    const id = (list[i].match(/\/jobs\/view\/(\d+)/) || [])[1] || "";
    const meta = metas[i];
    if (!meta || !meta.title) continue;
    cards.push({ id, url: list[i], title: meta.title, company: meta.company || "LinkedIn", location: "Remote", postedAt: null, description: meta.description || "" });
  }
  return cards;
}

// Discover LinkedIn jobs (guest API primary, web-search fallback), attach
// descriptions to the newest few, and return normalized jobs.
async function fetchLinkedInJobs() {
  let cards = await fetchLinkedInGuest();
  if (!cards.length) {
    console.warn("[Jobs] LinkedIn guest API returned nothing — falling back to web search.");
    cards = await fetchLinkedInViaSearch();
  }
  if (!cards.length) {
    console.warn("[Jobs] LinkedIn: no jobs found this scan.");
    return [];
  }

  // Fetch descriptions for postings that don't already have one (for the matcher).
  const needDesc = cards.filter((c) => !c.description).slice(0, MAX_DESC_FETCH);
  const descs = await Promise.all(needDesc.map((c) => fetchDescription(c.url)));
  const descMap = new Map(needDesc.map((c, i) => [c.id, descs[i]]));

  // These postings came from the guest API with f_WT=2 = REMOTE-ONLY, so they
  // are all remote even when the card shows a city. Mark them "Remote (city)"
  // so the pipeline's location gate (isLocationAllowed) doesn't wrongly skip
  // them, while keeping the geo context for the matcher.
  const jobs = cards.map((c) => ({
    source: "linkedin",
    refId: c.id,
    board: null,
    company: c.company,
    title: c.title,
    url: c.url,
    companyUrl: guessCompanyUrl(c.company),
    location: c.location && !/remote/i.test(c.location) ? `Remote (${c.location})` : (c.location || "Remote"),
    salary: null,
    description: c.description || descMap.get(c.id) || "",
    postedAt: c.postedAt,
  }));

  // AUTO-APPLY UPGRADE: web-search each job for its ATS posting (Greenhouse /
  // Lever / Ashby / Workable). If found, rewrite it to that source so the
  // existing engine auto-applies; otherwise it stays semi-auto (email).
  await upgradeToAts(jobs);

  const withDesc = jobs.filter((j) => j.description).length;
  const auto = jobs.filter((j) => j.source !== "linkedin").length;
  console.log(`[Jobs] LinkedIn: ${jobs.length} jobs (${withDesc} desc) — ${auto} upgraded to auto-apply ATS.`);
  return jobs;
}

// Search for the same job on a supported ATS board and, if found, rewrite the
// job to that source (auto-apply). Bounded per scan to keep the search cost sane.
async function upgradeToAts(jobs) {
  let upgraded = 0;
  for (const j of jobs) {
    if (upgraded >= ATS_SEARCH_MAX) break;
    if (!j.company || !j.title) continue;
    try {
      const ats = await discoverAtsPosting(j.company, j.title);
      if (ats) {
        j.source = ats.source;
        j.board = ats.board;
        j.refId = ats.refId;
        j.url = ats.url;
        upgraded++;
        console.log(`[Jobs] LinkedIn→ATS ${j.company} / ${j.title} → ${ats.source} (auto-apply)`);
      }
    } catch (e) {
      console.warn(`[Jobs] LinkedIn→ATS search failed ${j.company}: ${e.message.slice(0, 60)}`);
    }
  }
  return upgraded;
}

// ── ATS board specs: public (keyless) job-list APIs for each supported ATS ──
const ATS_SPECS = {
  greenhouse: {
    host: "boards.greenhouse.io",
    api: (b) => `https://boards-api.greenhouse.io/v1/boards/${b}/jobs`,
    jobs: (r) => (r && r.jobs) || [],
    pick: (j) => ({ title: j.title, url: j.absolute_url, refId: String(j.id) }),
  },
  lever: {
    host: "jobs.lever.co",
    api: (b) => `https://api.lever.co/v0/postings/${b}?mode=json`,
    jobs: (r) => (Array.isArray(r) ? r : []),
    pick: (j) => ({ title: (j.text || "").split(" at ")[0].trim(), url: j.hostedUrl, refId: j.id }),
  },
  ashby: {
    host: "jobs.ashbyhq.com",
    api: (b) => `https://api.ashbyhq.com/posting-api/job-board/${b}`,
    jobs: (r) => (r && r.jobs) || [],
    pick: (j) => ({ title: j.title, url: j.jobUrl, refId: j.id }),
  },
  workable: {
    host: "apply.workable.com",
    api: (b) => `https://apply.workable.com/api/v1/widget/accounts/${b}`,
    jobs: (r) => (r && r.jobs) || [],
    pick: (j) => ({ title: j.title, url: j.url, refId: j.shortcode || (j.url || "").split("/").pop() }),
  },
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Tolerant ATS URL parse — the web search snippets TRUNCATE URLs (280-char
// snippets cut them mid-way), so we must accept board-only URLs too. Returns
// { source, board, refId?, url } or null. refId is optional (board homepage).
function parseAtsUrl(raw) {
  try {
    const u = String(raw).split(/[?#]/)[0];
    let m;
    if ((m = u.match(/boards\.greenhouse\.io\/([^/]+)(?:\/jobs(?:\/(\d+))?)?/)))
      return { source: "greenhouse", board: decodeURIComponent(m[1]), refId: m[2], url: raw };
    if ((m = u.match(/jobs\.lever\.co\/([^/]+)(?:\/([a-zA-Z0-9-]+))?/)))
      return { source: "lever", board: decodeURIComponent(m[1]), refId: m[2], url: raw };
    if ((m = u.match(/jobs\.ashbyhq\.com\/([^/]+)(?:\/([a-zA-Z0-9-]+))?/)))
      return { source: "ashby", board: decodeURIComponent(m[1]), refId: m[2], url: raw };
    if ((m = u.match(/apply\.workable\.com\/([^/]+)(?:\/(?:j\/)?([a-zA-Z0-9-]+))?/)))
      return { source: "workable", board: decodeURIComponent(m[1]), refId: m[2], url: raw };
  } catch (e) { /* bad url */ }
  return null;
}

// Overlap score (0..1) between two normalized titles. 0.6 threshold keeps
// "AI Engineer" ↔ "Applied AI Engineer" (match) but rejects "AI Engineer" ↔
// "Software Engineer" (only "engineer" shared).
function titleScore(a, b) {
  const A = norm(a).split(/\s+/).filter((w) => w.length > 1);
  const B = norm(b).split(/\s+/).filter((w) => w.length > 1);
  if (!A.length || !B.length) return 0;
  const shared = A.filter((w) => B.includes(w)).length;
  return shared / Math.max(A.length, B.length);
}

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const lib = url.startsWith("https") ? require("https") : require("http");
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { clearTimeout(timer); try { resolve(JSON.parse(d)); } catch (e) { reject(new Error("bad json")); } });
    }).on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// Fetch the board's job list and return the best title-matching posting.
// Returns null if the API responded but no posting matches the title. THROWS
// if the API is unreachable (caller treats that as "can't resolve").
async function resolveBoardPosting(ats, title) {
  const spec = ATS_SPECS[ats.source];
  const r = await fetchJson(spec.api(ats.board));
  let best = null, bestScore = 0;
  for (const j of spec.jobs(r)) {
    const p = spec.pick(j);
    if (!p || !p.title || !p.url) continue;
    const s = titleScore(title, p.title);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  if (best && bestScore >= 0.6) {
    return { source: ats.source, board: ats.board, refId: best.refId, url: best.url };
  }
  return null;
}

// Web-search for the company's ATS board, then resolve the exact posting from
// that board's official API by title. Returns { source, board, refId, url } or
// null. STRICT: the ATS board slug must match the company, so we never
// auto-apply to a different company's posting that happens to share a title.
async function discoverAtsPosting(company, title) {
  const q = `"${company}" site:jobs.ashbyhq.com OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:apply.workable.com`;
  let text = "";
  try { const r = await searchWeb(q, 6000); text = (r && r.results) || ""; } catch (e) { return null; }
  // Looser extraction: snippets truncate URLs, so grab any http(s) token.
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  const cNorm = norm(company);
  const boards = [];
  for (const u of urls) {
    const ats = parseAtsUrl(u);
    if (!ats || !ATS_SPECS[ats.source]) continue;
    const bNorm = norm(ats.board);
    // STRICT company guard: only accept when the board slug and the company
    // fully contain each other (e.g. "Northflank" ↔ "northflank.com", "Unison
    // Group" ↔ "unison"). We deliberately do NOT use fuzzy/prefix matching —
    // e.g. "AlgorithmX" must never match the unrelated board "algoritmi".
    if (!(bNorm.includes(cNorm) || cNorm.includes(bNorm))) continue;
    if (!boards.some((b) => b.source === ats.source && norm(b.board) === bNorm)) boards.push(ats);
  }
  if (!boards.length) return null;

  // Primary: ask the board's official API which posting matches THIS title
  // (never auto-apply to a different role at the same company just because a
  // snippet surfaced its board).
  let anyApiOk = false;
  let lastResort = null;
  for (const b of boards) {
    let post = null;
    try {
      post = await resolveBoardPosting(b, title);
      anyApiOk = true; // API responded (post may be null if title didn't match)
    } catch (e) { /* board API unreachable — remember a direct URL to fall back to */ }
    if (post) return post;
    if (b.refId && !lastResort) lastResort = { source: b.source, board: b.board, refId: b.refId, url: b.url };
  }
  // Last resort: only when no board API responded do we trust a direct posting
  // URL that the search surfaced (an unreachable API shouldn't block auto-apply).
  if (!anyApiOk && lastResort) return lastResort;
  return null;
}

module.exports = { fetchLinkedInJobs, discoverAtsPosting };
