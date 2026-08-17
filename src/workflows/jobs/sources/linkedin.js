// LinkedIn job discovery via LinkedIn's PUBLIC guest jobs endpoint — no API
// key, no login. This is the same unauthenticated JSON endpoint that powers the
// public linkedin.com/jobs search page (f_WT=2 = remote-only).
//
// The response is HTML cards, each carrying: jobPosting id, view URL, title,
// company, location, and posted date. We then fetch a few posting pages for
// their description so the matcher can score properly.
//
// LinkedIn jobs have NO auto-apply path (Easy Apply is not scriptable), so they
// are "semi-auto": discovered, scored, queued, and shown in /jobs queue with
// their apply URL for manual submission. The apply engine already treats any
// unknown source this way.
const { searchWeb } = require("../../../llm/webSearch");

const KEYWORDS = [
  "AI Engineer",
  "Machine Learning Engineer",
  "Cloud Engineer",
  "DevOps Engineer",
  "Backend Developer",
  "Python Developer",
  "Automation Engineer",
  "Platform Engineer",
];
const MAX_CARDS = 40; // cards parsed per scan (8 keywords × 10/page, capped)
const MAX_DESC_FETCH = 10; // posting pages to fetch for description

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
    const postedAt = (block.match(/job-search-card__listdate" datetime="([^"]+)"/) || [])[1];
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

// Primary: LinkedIn guest jobs search endpoint (public, remote-only).
async function fetchLinkedInGuest() {
  const seen = new Map(); // id -> card
  for (const kw of KEYWORDS) {
    if (seen.size >= MAX_CARDS) break;
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&location=Remote&f_WT=2&start=0`;
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

  const jobs = cards.map((c) => ({
    source: "linkedin",
    refId: c.id,
    board: null,
    company: c.company,
    title: c.title,
    url: c.url,
    location: c.location,
    salary: null,
    description: c.description || descMap.get(c.id) || "",
    postedAt: c.postedAt,
  }));
  const withDesc = jobs.filter((j) => j.description).length;
  console.log(`[Jobs] LinkedIn: ${jobs.length} jobs (${withDesc} with description).`);
  return jobs;
}

module.exports = { fetchLinkedInJobs };
