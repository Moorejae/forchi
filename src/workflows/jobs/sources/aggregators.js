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
const { stripHtml } = require("./ats");

// Keywords matching the profile's target roles + core skills.
// A job is kept if its title OR tags contain any of these.
const KEEP = [
  "ai", "llm", "ml engineer", "machine learning", "mlops", "aiops",
  "ai integration", "ai automation", "ai solutions", "integration engineer", "solutions engineer",
  "cloud", "devops", "backend", "full stack", "fullstack",
  "automation", "python", "node", "sre", "platform engineer",
  "infrastructure", "data engineer", "software engineer", "software developer",
  "aws", "azure", "gcp", "kubernetes", "docker", "terraform",
];

function passesFilter(title, tagsText) {
  const t = `${title || ""} ${tagsText || ""}`.toLowerCase();
  return KEEP.some((k) => t.includes(k));
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

module.exports = { fetchAggregators, fetchRemotive, fetchJobicy, fetchArbeitnow, fetchHimalayas, detectAts, passesFilter };
