// Free remote-job aggregator feeds (no API key, public JSON).
// Sources: Remotive, Jobicy, Arbeitnow, Himalayas.
//
// Each job goes through:
//   1. A keyword PRE-FILTER (title + tags vs target roles/skills) so we don't
//      insert hundreds of irrelevant listings and burn Gemini scoring calls.
//   2. ATS detection — if the listing URL points DIRECTLY at a supported ATS
//      (Greenhouse/Lever/Ashby/Workable), we rewrite source/board/refId so the
//      existing auto-apply engine can submit it like a company-board job.
//      Otherwise the job stays "semi-auto" (discovered + scored + queued, but
//      never auto-submitted — shown in /jobs queue with its URL for manual apply).
const { stripHtml, guessCompanyUrl } = require("./ats");

// STRICT search recipe (USER DIRECTIVE 2026-09-01): the scanner ONLY keeps
// INTERNSHIP / JUNIOR / ENTRY-LEVEL roles that fall under ONE of these domains:
//   1. Cloud Security
//   2. DevOps / SRE / Platform Engineering   (USER ADD 2026-09-01)
//   3. AI Integration
//   4. Workflow Automation
//   5. API Integration
// A job is kept ONLY if its title OR tags contain BOTH:
//   - a LEVEL keyword (intern / internship / junior / entry level / graduate...)
//   - a DOMAIN keyword from one of the clusters below.
// Anything else (senior/lead/staff titles, unrelated domains, contractor/
// freelance gigs, generic full-stack without a level signal) is dropped here so
// the Gemini scoring calls aren't wasted on noise.
const LEVEL_TERMS = [
  "intern", "internship", "junior", "entry level", "entry-level",
  "graduate", "new grad", "new graduate", "recent grad", "associate",
];

// Five focus domains (user directive + DevOps add). Each cluster has a regex so
// partial matches ("AI engineer", "cloud security analyst", "devops intern")
// still hit. Overlaps are fine — matches are OR'd across clusters.
const DOMAINS = [
  // 1. Cloud Security
  /(cloud security|security engineer|security analyst|cyber|zero trust|waf|vulnerab|pen ?test|cloud security|aws|azure|gcp|google cloud|oracle cloud)/i,
  // 2. DevOps / SRE / Platform Engineering (USER ADD 2026-09-01)
  /(devops|sre|site reliability|platform engineer|cloud engineer|infrastructure engineer|kubernetes|docker|terraform|ci\/cd|linux|release engineer)/i,
  // 3. AI Integration
  /(ai integration|ai engineer|llm|machine learning|ml engineer|\bmlops\b|\baiops\b|agentic|ai agent|langchain|\brag\b|prompt|artificial intelligence|genai|generative ai|ai solutions|ai automation)/i,
  // 4. Workflow Automation
  /(workflow automation|automation engineer|workflow|process automation|\brpa\b|\bn8n\b|zapier|make\.com|business automation|automation developer|integration automation)/i,
  // 5. API Integration
  /(api integration|integration engineer|api engineer|backend|webhook|restful|\brest\b|api developer|apis?\b|sdk)/i,
];

function passesFilter(title, tagsText) {
  const t = `${title || ""} ${tagsText || ""}`.toLowerCase();
  const hasLevel = LEVEL_TERMS.some((k) => t.includes(k));
  if (!hasLevel) return false; // STRICT: must be intern/junior/entry-level
  // STRICT: must match at least one of the four focus domains.
  return DOMAINS.some((re) => re.test(t));
}

// Recency pre-filter: only keep jobs posted within MAX_AGE_DAYS (default 14),
// when the feed provides a posted date. Unknown age → kept (created_at proxy
// in the pipeline catches staleness later). Keeps the queue fresh + fast.
const MAX_AGE_DAYS = Number(process.env.JOBS_MAX_AGE_DAYS || 14);
function isFreshEnough(postedAt) {
  if (!postedAt) return true;
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) / 86400000 <= MAX_AGE_DAYS;
}

// If the job URL is a direct supported-ATS posting, return its ATS identity so
// the job can be auto-applied. Otherwise null (stays semi-auto).
function detectAts(url) {
  const u = url || "";
  let m;
  if ((m = u.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/))) return { source: "greenhouse", board: m[1], refId: m[2] };
  if ((m = u.match(/jobs\.lever\.co\/([^/]+)\/([a-zA-Z0-9-]+)/))) return { source: "lever", board: m[1], refId: m[2] };
  if ((m = u.match(/jobs\.ashbyhq\.com\/([^/]+)\/([a-zA-Z0-9-]+)/))) return { source: "ashby", board: m[1], refId: m[2] };
  if ((m = u.match(/apply\.workable\.com\/([^/]+)\/(?:j\/)?([a-zA-Z0-9-]+)/))) return { source: "workable", board: m[1], refId: m[2] };
  return null;
}

function normalize({ source, refId, company, title, url, location, salary, description, tags, postedAt }) {
  const ats = detectAts(url);
  return {
    source: (ats && ats.source) || source,
    refId: (ats && ats.refId) || refId || "",
    board: (ats && ats.board) || null,
    company: company || "?",
    title: title || "Untitled",
    url: url || "",
    companyUrl: guessCompanyUrl(company),
    location: location || "Remote",
    salary: salary || null,
    description: stripHtml(description).slice(0, 12000),
    postedAt: postedAt || null,
    tags: Array.isArray(tags) ? tags.join(" ") : (tags || ""),
  };
}

// ── Remotive (all remote; JSON) ──────────────────────────────────────────────
async function fetchRemotive() {
  const res = await fetch("https://remotive.com/api/remote-jobs", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ForChiJobs/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Remotive: HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const j of (data.jobs || [])) {
    if (out.length >= 80) break;
    const title = j.title || "";
    const tags = [j.category || "", ...(j.tags || [])].join(" ");
    if (!passesFilter(title, tags)) continue;
    if (!isFreshEnough(j.publication_date)) continue; // drop >14d old
    out.push(normalize({
      source: "remotive",
      refId: String(j.id || ""),
      company: j.company_name || "?",
      title,
      url: j.url || "",
      location: j.candidate_required_location || "Remote",
      salary: j.salary || null,
      description: `${j.description || ""} ${tags}`,
      tags: (j.tags || []),
      postedAt: j.publication_date || null,
    }));
  }
  return out;
}

// ── Jobicy (remote; JSON) ────────────────────────────────────────────────────
async function fetchJobicy() {
  // No industry filter (valid slugs are restrictive); the keyword pre-filter
  // below does the relevance work instead.
  const res = await fetch("https://jobicy.com/api/v2/remote-jobs?count=100", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ForChiJobs/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Jobicy: HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const j of (data.jobs || [])) {
    if (out.length >= 60) break;
    const title = j.jobTitle || "";
    const tags = `${j.jobIndustry || ""} ${j.jobType || ""} ${j.jobLevel || ""}`;
    if (!passesFilter(title, tags)) continue;
    if (!isFreshEnough(j.pubDate)) continue; // drop >14d old
    out.push(normalize({
      source: "jobicy",
      refId: String(j.id || ""),
      company: j.companyName || "?",
      title,
      url: j.url || "",
      location: j.jobGeo || "Remote",
      salary: j.salaryMin && j.salaryMax ? `${j.salaryCurrency || "$"}${j.salaryMin}-${j.salaryMax}` : null,
      description: j.jobExcerpt || j.jobDescription || "",
      tags,
      postedAt: j.pubDate || null,
    }));
  }
  return out;
}

// ── Arbeitnow (remote-focused; JSON) ─────────────────────────────────────────
async function fetchArbeitnow() {
  const res = await fetch("https://arbeitnow.com/api/job-board-api?page=1", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ForChiJobs/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Arbeitnow: HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const j of (data.data || [])) {
    if (out.length >= 60) break;
    const title = j.title || "";
    const tags = (j.tags || []).join(" ");
    if (!passesFilter(title, tags)) continue;
    if (!isFreshEnough(j.created_at ? new Date(j.created_at * 1000).toISOString() : null)) continue; // drop >14d old
    out.push(normalize({
      source: "arbeitnow",
      refId: j.slug || "",
      company: j.company_name || "?",
      title,
      url: j.url || `https://www.arbeitnow.com/jobs/${j.slug || ""}`,
      location: j.remote ? "Remote" : (Array.isArray(j.location) ? j.location.join(", ") : (j.location || "Remote")),
      salary: null,
      description: j.description || `${tags}`,
      tags: j.tags || [],
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    }));
  }
  return out;
}

// ── Himalayas (remote; JSON, wrapped in { jobs: [...] }) ─────────────────────
async function fetchHimalayas() {
  const res = await fetch("https://himalayas.app/jobs/api", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ForChiJobs/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Himalayas: HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const j of (data.jobs || [])) {
    if (out.length >= 60) break;
    const title = j.title || "";
    const tags = (Array.isArray(j.categories) ? j.categories.join(" ") : "") + " " + (Array.isArray(j.seniority) ? j.seniority.join(" ") : "");
    if (!passesFilter(title, tags)) continue;
    if (!isFreshEnough(j.pubDate)) continue; // drop >14d old
    const salary = j.minSalary && j.maxSalary
      ? `${j.currency || "$"}${j.minSalary}-${j.maxSalary} ${j.salaryPeriod || "annual"}`
      : (j.minSalary ? `${j.currency || "$"}${j.minSalary} ${j.salaryPeriod || "annual"}` : null);
    out.push(normalize({
      source: "himalayas",
      refId: j.guid || j.companySlug || "",
      company: j.companyName || "?",
      title,
      url: j.applicationLink || `https://himalayas.app/companies/${j.companySlug || ""}/jobs/${j.guid || ""}`,
      location: (Array.isArray(j.locationRestrictions) && j.locationRestrictions.length) ? j.locationRestrictions.join(", ") : "Remote",
      salary,
      description: j.description || j.excerpt || "",
      tags,
      postedAt: j.pubDate || null,
    }));
  }
  return out;
}

async function fetchAggregators() {
  const results = await Promise.allSettled([fetchRemotive(), fetchJobicy(), fetchArbeitnow(), fetchHimalayas()]);
  const out = [];
  results.forEach((r, i) => {
    const name = ["remotive", "jobicy", "arbeitnow", "himalayas"][i];
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn(`[Jobs] ${name} skipped (${r.reason?.message || r.reason})`);
  });
  return out;
}

module.exports = { fetchAggregators, fetchRemotive, fetchJobicy, fetchArbeitnow, fetchHimalayas, detectAts, passesFilter, isFreshEnough };
