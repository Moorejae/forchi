// ATS job-board scrapers: Greenhouse, Lever, Workable, Ashby.
// These are the modern ATS with PUBLIC postings (no Cloudflare) — the user's
// core insight. Each returns a normalized array of jobs (or throws; callers
// must catch and skip).
const stripHtml = (html = "") =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

function normalize({ source, refId, board, company, title, url, location, salary, description, postedAt, companyUrl }) {
  return {
    source, refId, board, company, title, url,
    companyUrl: companyUrl || guessCompanyUrl(company),
    location: location ? String(location).trim() : null,
    salary: salary || null,
    description: stripHtml(description).slice(0, 12000),
    postedAt,
  };
}

// USER DIRECTIVE (2026-09-02): prefer applying via the company's own website.
// Derive a best-effort company website URL from the name so the resume/cover
// letter/email can point the reader at the real company site (never a LinkedIn
// or jobsite aggregator URL). Best-effort; callers may override with companyUrl.
function guessCompanyUrl(company) {
  const name = String(company || "").trim();
  if (!name || name === "?") return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^(the|my|get|go|app|use)\b/, "");
  if (!slug) return null;
  return `https://${slug}.com`;
}

// ── Greenhouse ───────────────────────────────────────────────────────────────
async function fetchGreenhouse(slug, companyUrl) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Greenhouse ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  const companyName = data.company_name || slug;
  return (data.jobs || []).map((j) =>
    normalize({
      source: "greenhouse",
      refId: String(j.id || ""),
      board: slug,
      company: companyName,
      title: j.title || "Untitled",
      url: j.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${j.id}`,
      location: j.location && j.location.name,
      description: j.content || "",
      postedAt: j.first_published || j.updated_at || null,
      companyUrl,
    })
  );
}

// ── Lever ────────────────────────────────────────────────────────────────────
async function fetchLever(slug, companyUrl) {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Lever ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((p) =>
    normalize({
      source: "lever",
      refId: p.id || "",
      board: slug,
      company: p.company || slug,
      title: p.text || p.title || "Untitled",
      url: p.hostedUrl || `https://jobs.lever.co/${slug}`,
      location: p.categories && p.categories.location,
      description: p.descriptionPlain || p.description || "",
      postedAt: p.createdAt || null,
      companyUrl,
    })
  );
}

// ── Workable (best-effort; many accounts require auth) ───────────────────────
async function fetchWorkable(slug, companyUrl) {
  const res = await fetch(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Workable ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) =>
    normalize({
      source: "workable",
      refId: j.shortcode || j.id || "",
      board: slug,
      company: j.company && j.company.name ? j.company.name : slug,
      title: j.title || "Untitled",
      url: j.url || `https://apply.workable.com/${slug}/j/${j.shortcode || ""}/`,
      location: (j.telecommuting ? "Remote " : "") + (j.city || "") + " " + (j.country || ""),
      salary: j.salary ? `${j.salary.currency || ""} ${j.salary.range || ""}` : null,
      description: j.description || "",
      postedAt: j.published_on || null,
      companyUrl,
    })
  );
}

// ── Ashby ────────────────────────────────────────────────────────────────────
async function fetchAshby(slug, companyUrl) {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Ashby ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  const boardName = data.jobBoard && data.jobBoard.name ? data.jobBoard.name : slug;
  return (data.jobs || []).map((j) =>
    normalize({
      source: "ashby",
      refId: j.id || "",
      board: slug,
      company: boardName,
      title: j.title || "Untitled",
      url: j.jobUrl || `https://jobs.ashbyhq.com/${slug}/${j.id || ""}`,
      location: j.location || "",
      salary: j.compensation ? JSON.stringify(j.compensation) : null,
      description: j.descriptionHtml || j.descriptionPlain || "",
      postedAt: j.publishedAt || null,
      companyUrl,
    })
  );
}

// Route by company config.
async function fetchCompanyBoard(company) {
  const companyUrl = company.url || guessCompanyUrl(company.name);
  switch (company.ats) {
    case "greenhouse": return fetchGreenhouse(company.slug, companyUrl);
    case "lever": return fetchLever(company.slug, companyUrl);
    case "workable": return fetchWorkable(company.slug, companyUrl);
    case "ashby": return fetchAshby(company.slug, companyUrl);
    default: return [];
  }
}

module.exports = { fetchGreenhouse, fetchLever, fetchWorkable, fetchAshby, fetchCompanyBoard, stripHtml, guessCompanyUrl };
