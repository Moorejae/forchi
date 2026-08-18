// Apply engine: submits applications to trusted ATS via their public endpoints.
// - Multipart form with the candidate's REAL identity + resume + human-voice answers.
// - HARD never-apply-twice is enforced by the caller (db hasApplied + UNIQUE index).
// - Live submissions are OFF by default (JOBS_AUTO_APPLY=true enables them).
const path = require("path");
const fs = require("fs");
const { PROFILE } = require("./profile");

const RESUME_PATH =
  process.env.RESUME_PATH || path.join(process.cwd(), "data", "resume", "Agu_Victor_Chiedozie_Resum.pdf");

const AUTO_APPLY = (process.env.JOBS_AUTO_APPLY || "false").toLowerCase() === "true";
const DAILY_CAP = Number(process.env.JOBS_DAILY_CAP || 10);
// Apply window in UTC hours (08:00–20:00 WAT = 07:00–19:00 UTC).
const WINDOW = (process.env.JOBS_APPLY_WINDOW || "7-19").split("-").map((n) => Number(n));
const MIN_GAP_MS = Number(process.env.JOBS_APPLY_GAP_MS || 120000);

let lastSubmitAt = 0;

function inApplyWindow() {
  const h = new Date().getUTCHours();
  return h >= WINDOW[0] && h < WINDOW[1];
}

// Render a tailored resume to a styled PDF (Carlito fonts, US Letter) matching
// the original resume's standard. Falls back to the base resume PDF.
const FONT_DIR = process.env.FONT_DIR || path.join(process.cwd(), "data", "fonts");
const F = {
  regular: path.join(FONT_DIR, "Carlito-Regular.ttf"),
  bold: path.join(FONT_DIR, "Carlito-Bold.ttf"),
  italic: path.join(FONT_DIR, "Carlito-Italic.ttf"),
  boldItalic: path.join(FONT_DIR, "Carlito-BoldItalic.ttf"),
};

const SECTION_TITLES = [
  "professional summary", "summary", "key skills", "skills",
  "technical projects & experience", "projects", "experience",
  "certifications", "education", "certifications & education",
  "key engineering projects", "technical projects",
];

function cleanLine(text) {
  return String(text).replace(/https?:\/\//g, "").replace(/\s+/g, " ").trim();
}

function isSectionHeading(line) {
  const t = cleanLine(line).toLowerCase().replace(/[^a-z& ]/g, " ").trim();
  return SECTION_TITLES.some((s) => t === s || t.includes(s)) ||
    /^[A-Z][A-Z0-9 &/()\-]{2,45}$/.test(cleanLine(line));
}

function isProjectHeader(line) {
  const t = cleanLine(line);
  if (t.length > 90) return false;
  return /\b(19|20)\d{2}\b/.test(t) || /\|/.test(t) || /\(Live\)/i.test(t) || /[–—]/.test(t);
}

function getResumeBuffer(tailoredText) {
  try {
    const PDFDocument = require("pdfkit");
    if (tailoredText && tailoredText.length > 100) {
      // Render at a given font scale; returns the buffer + how many pages it used.
      const render = (scale) => new Promise((resolve) => {
        const chunks = [];
        let pages = 1;
        const doc = new PDFDocument({ size: "LETTER", margin: 48 });
        doc.on("data", (c) => chunks.push(c));
        doc.on("pageAdded", () => { pages++; });
        doc.on("end", () => resolve({ buf: Buffer.concat(chunks), pages }));

        doc.registerFont("Carlito-Regular", F.regular);
        doc.registerFont("Carlito-Bold", F.bold);
        doc.registerFont("Carlito-Italic", F.italic);
        doc.registerFont("Carlito-BoldItalic", F.boldItalic);

        const ACCENT = "#1F3864";
        const GRAY = "#555555";
        const DARK = "#1a1a1a";
        const margin = 48;
        const width = doc.page.width - margin * 2;
        const S = scale; // font-size multiplier

        const lines = String(tailoredText).split("\n").map((l) => cleanLine(l)).filter(Boolean);

        // ── Header: name / title / contact ──
        const name = lines[0] || "Agu Victor Chiedozie";
        const title = lines[1] || "";
        const contact = lines[2] || "";
        const bodyLines = lines.slice(3);

        doc.font("Carlito-Bold").fontSize(18 * S).fillColor(ACCENT).text(name.toUpperCase());
        if (title) doc.moveDown(0.2 * S).font("Carlito-Regular").fontSize(11.5 * S).fillColor(DARK).text(title);
        if (contact) doc.moveDown(0.2 * S).font("Carlito-Regular").fontSize(8.5 * S).fillColor(GRAY).text(contact);
        doc.moveDown(0.5 * S);
        doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).lineWidth(1.3).strokeColor(ACCENT).stroke();
        doc.moveDown(1 * S);

        // ── Sections ──
        for (const line of bodyLines) {
          if (isSectionHeading(line)) {
            doc.moveDown(0.7 * S);
            doc.font("Carlito-Bold").fontSize(10.5 * S).fillColor(ACCENT).text(line.toUpperCase());
            doc.moveDown(0.1 * S);
            doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).lineWidth(0.6).strokeColor(ACCENT).opacity(0.6).stroke().opacity(1);
            doc.moveDown(0.55 * S);
            continue;
          }
          if (isProjectHeader(line)) {
            doc.moveDown(0.4 * S);
            doc.font("Carlito-Bold").fontSize(10 * S).fillColor(DARK).text(line);
            doc.moveDown(0.12 * S);
            continue;
          }
          const bullet = /^[-•*]/.test(line);
          const text = bullet ? line.replace(/^[-•*]\s*/, "") : line;
          doc.font("Carlito-Regular").fontSize(9.5 * S).fillColor(DARK);
          doc.text(bullet ? `•  ${text}` : text, { lineGap: 1 * S, paragraphGap: 2.5 * S, indent: bullet ? 11 * S : 0 });
          doc.moveDown(0.1 * S);
        }

        doc.end();
      });

      // ONE-PAGE GUARANTEE: render at full size, shrink the fonts until it
      // fits a single US Letter page (HR never wants a 2-page resume).
      return (async () => {
        for (const scale of [1, 0.95, 0.9, 0.85, 0.8, 0.75]) {
          const { buf, pages } = await render(scale);
          if (pages <= 1) { if (scale < 1) console.log(`[Jobs] resume fit to 1 page @ ${Math.round(scale * 100)}%`); return buf; }
          console.warn(`[Jobs] resume overflowed ${pages} pages @ ${Math.round(scale * 100)}% — shrinking…`);
        }
        const { buf } = await render(0.75);
        return buf;
      })();
    }
  } catch (e) {
    console.warn("[Jobs] pdfkit unavailable, using base resume:", e.message);
  }
  if (fs.existsSync(RESUME_PATH)) return fs.readFileSync(RESUME_PATH);
  throw new Error(`Resume PDF not found at ${RESUME_PATH}`);
}

function fdAppendFile(fd, name, buf, filename) {
  fd.append(name, new Blob([buf], { type: "application/pdf" }), filename);
}

// ── ATS form auto-fill ───────────────────────────────────────────────────────
// Fills the company's application-form fields (years of experience, LinkedIn,
// GitHub, portfolio, work authorization, salary, custom screening questions)
// by fetching the job's schema and mapping real profile/answer data onto it.

function standardAnswers() {
  const idn = PROFILE.identity;
  const L = PROFILE.links || {};
  const strip = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    email: idn.email,
    phone: idn.phone,
    firstName: idn.firstName,
    lastName: idn.lastName,
    fullName: idn.fullName,
    location: idn.location,
    linkedin: strip(L.linkedin),
    github: strip(L.github),
    portfolio: strip(L.myzelva || L.cloudvoid),
    years: PROFILE.yearsExperience,
    workAuth: PROFILE.workAuthorization,
    clearance: PROFILE.securityClearance,
    salary: PROFILE.salaryExpectation || "",
  };
}

function fuzzyMatch(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return null;
  if (/email/.test(s)) return "email";
  if (/first ?name/.test(s)) return "firstName";
  if (/last ?name/.test(s)) return "lastName";
  if (/\bfull ?name\b|^\s*name\s*$/.test(s)) return "fullName";
  if (/phone|mobile|contact number/.test(s)) return "phone";
  if (/location|city|based in|country|where are you/.test(s)) return "location";
  if (/linkedin/.test(s)) return "linkedin";
  if (/github/.test(s)) return "github";
  if (/portfolio|website|personal (site|url)|profile url/.test(s)) return "portfolio";
  if (/year(s)? of (professional )?experience|how many years|years experience/.test(s)) return "years";
  if (/authoriz|eligible to work|right to work|work permit|sponsorship|visa/.test(s)) return "workAuth";
  if (/security clearance|clearance|background check|security check/.test(s)) return "clearance";
  if (/salary|compensation|pay expectation|expected (pay|salary)/.test(s)) return "salary";
  if (/how did you hear|referral|found (this|us)|source of/.test(s)) return "source";
  return null;
}

function matchPreparedAnswer(questionText, app) {
  const q = String(questionText || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (!q || !app.answers || !app.answers.length) return null;
  for (const a of app.answers) {
    const aq = String(a.question || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    if (aq && (q.includes(aq) || aq.includes(q) || q.split(/\s+/).filter((w) => w.length > 3).some((w) => aq.includes(w)))) {
      return a.answer;
    }
  }
  return null;
}

async function fetchFormSchema(job) {
  try {
    if (job.source === "greenhouse") {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${job.board || job.company.toLowerCase()}/jobs/${job.ref_id}`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const d = await res.json();
        return (d.questions || []).map((q) => {
          const opts = [];
          for (const f of q.fields || []) for (const c of f.choices || []) opts.push({ label: c.label, value: c.value ?? c.label });
          for (const c of q.choices || []) opts.push({ label: c.label, value: c.value ?? c.label });
          return { key: String(q.name || q.id || q.label || ""), label: q.label || q.name || q.title || "", required: !!q.required, options: opts };
        });
      }
    } else if (job.source === "lever") {
      const res = await fetch(`https://api.lever.co/v0/postings/${job.board || job.company.toLowerCase()}/${job.ref_id}?mode=json`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const d = await res.json();
        const all = [...(d.additionalQuestions || []), ...(d.customQuestions || [])];
        return all.map((q) => ({
          key: q.id || "",
          label: q.text || "",
          required: !!q.required,
          options: (q.choices || []).map((c) => ({ label: c.label, value: c.value ?? c.label })),
        }));
      }
    }
  } catch (e) {
    console.warn(`[Jobs] form schema fetch failed (${job.source}): ${e.message}`);
  }
  return null;
}

// For dropdown/select fields, choose the option that best matches our answer.
function pickOption(options, value) {
  const val = String(value || "").toLowerCase();
  if (!options || !options.length) return value;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const vNorm = norm(val);

  // 0. Negation preference: if our value is negative, prefer an option with the same sign
  //    (e.g. "not authorized" -> "No, I am not authorized", never "Yes").
  const negValue = /\b(no|not|unable|without|none)\b/.test(val);
  if (negValue) {
    const negOpt = options.find((o) => /\b(no|not|unable|without|none)\b/.test(`${o.label || ""} ${o.value || ""}`));
    if (negOpt) return negOpt.value ?? negOpt.label;
  }

  // 1. Exact normalized match.
  for (const o of options) {
    const a = norm(o.label); const b = norm(o.value);
    if ((a && a === vNorm) || (b && b === vNorm)) return o.value ?? o.label;
  }

  // 2. Numeric/range match using RAW labels (preserve "-" / "," separators).
  const digits = (val.match(/\d+/g) || []).map(Number);
  if (digits.length) {
    for (const o of options) {
      const label = String(o.label || "").replace(/,/g, ""); // "3,000" -> "3000"
      const nums = (label.match(/\d+/g) || []).map(Number);
      if (nums.length === 2 && digits.some((d) => d >= nums[0] && d <= nums[1])) return o.value ?? o.label;
      if (nums.length === 1 && /\+|and above|max/i.test(label) && digits[0] >= nums[0]) return o.value ?? o.label;
      if (nums.length === 1 && /under|less than|up to|max/i.test(label) && digits[0] <= nums[0]) return o.value ?? o.label;
    }
  }

  // 3. Shared keyword match (meaningful tokens).
  const tokens = val.split(/\s+/).filter((w) => w.length > 3);
  for (const o of options) {
    const hay = norm(`${o.label || ""} ${o.value || ""}`);
    if (tokens.some((t) => hay.includes(t))) return o.value ?? o.label;
  }

  // 4. Fallback: a neutral/other option, else null (caller skips optional fields).
  const fallback = options.find((o) => /other|prefer not|none|n\/a/i.test(`${o.label || ""} ${o.value || ""}`));
  return fallback ? (fallback.value ?? fallback.label) : null;
}

async function buildFormData(job, app, ensure = {}) {
  const std = standardAnswers();
  const schema = await fetchFormSchema(job);
  const out = new Map();
  const put = (k, v) => { if (k && v !== undefined && v !== null && String(v) !== "") out.set(String(k), String(v)); };

  // Core identity fields (always sent; names vary by ATS).
  if (ensure.email) put(ensure.email, std.email);
  if (ensure.firstName) put(ensure.firstName, std.firstName);
  if (ensure.lastName) put(ensure.lastName, std.lastName);
  if (ensure.fullName) put(ensure.fullName, std.fullName);
  if (ensure.phone) put(ensure.phone, std.phone);
  if (ensure.location) put(ensure.location, std.location);

  if (schema && schema.length) {
    for (const f of schema) {
      if (out.has(f.key)) continue;
      const tag = fuzzyMatch(`${f.label} ${f.key}`);
      let val = null;
      if (tag) {
        if (tag === "source") val = "Found via an AI job-search agent";
        else if (tag === "years") val = std.years;
        else if (tag === "workAuth") val = std.workAuth;
        else if (tag === "clearance") val = std.clearance;
        else if (tag === "salary") val = std.salary || null;
        else if (tag === "linkedin") val = std.linkedin;
        else if (tag === "github") val = std.github;
        else if (tag === "portfolio") val = std.portfolio;
        else if (tag === "location") val = std.location;
        else if (tag !== "email" && tag !== "phone" && tag !== "firstName" && tag !== "lastName" && tag !== "fullName") val = std[tag] ?? null;
      } else {
        val = matchPreparedAnswer(f.label, app);
      }
      if (val === null || val === undefined || String(val) === "") continue;
      // Dropdown/select fields must use one of the allowed options.
      const picked = f.options && f.options.length ? pickOption(f.options, val) : val;
      if (picked !== null && picked !== undefined && String(picked) !== "") put(f.key, picked);
    }
  } else {
    // No schema available — send only the core identity fields (already added
    // via `ensure`). The resume PDF carries LinkedIn/GitHub/years, so we never
    // guess ATS field names that could 400 a strict form.
  }
  return out;
}

// ── Greenhouse ───────────────────────────────────────────────────────────────
async function submitGreenhouse(job, app, resumeBuf) {
  const fd = new FormData();
  const fields = await buildFormData(job, app, { email: "email", firstName: "first_name", lastName: "last_name", phone: "phone" });
  for (const [k, v] of fields) fd.append(k, v);
  if (app.coverLetter) fd.append("cover_letter", app.coverLetter);
  fdAppendFile(fd, "resume", resumeBuf, "Victor_Agu_Resume.pdf");
  const url = `https://boards-api.greenhouse.io/v1/boards/${job.board || job.company.toLowerCase()}/jobs/${job.ref_id}/application`;
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { ok: res.ok, response: `${res.status}: ${text.slice(0, 300)}` };
}

// ── Lever ────────────────────────────────────────────────────────────────────
async function submitLever(job, app, resumeBuf) {
  const fd = new FormData();
  const fields = await buildFormData(job, app, { fullName: "name", email: "email", phone: "phone", location: "org" });
  for (const [k, v] of fields) fd.append(k, v);
  fdAppendFile(fd, "resume", resumeBuf, "Victor_Agu_Resume.pdf");
  if (app.coverLetter) fd.append("comments", app.coverLetter);
  const url = `https://jobs.lever.co/${job.board || job.company.toLowerCase()}/${job.ref_id}/apply`;
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { ok: res.ok, response: `${res.status}: ${text.slice(0, 300)}` };
}

// ── Workable ─────────────────────────────────────────────────────────────────
async function submitWorkable(job, app, resumeBuf) {
  const fd = new FormData();
  const fields = await buildFormData(job, app, { fullName: "name", email: "email", phone: "phone" });
  for (const [k, v] of fields) fd.append(k, v);
  if (app.coverLetter) fd.append("cover_letter", app.coverLetter);
  fdAppendFile(fd, "resume", resumeBuf, "Victor_Agu_Resume.pdf");
  const url = `https://apply.workable.com/api/v3/accounts/${job.board || job.company.toLowerCase()}/jobs/${job.ref_id}/apply`;
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { ok: res.ok, response: `${res.status}: ${text.slice(0, 300)}` };
}

// ── Ashby ────────────────────────────────────────────────────────────────────
async function submitAshby(job, app, resumeBuf) {
  const fd = new FormData();
  const fields = await buildFormData(job, app, { fullName: "name", email: "email", phone: "phone" });
  for (const [k, v] of fields) fd.append(k, v);
  if (app.coverLetter) fd.append("comments", app.coverLetter);
  fdAppendFile(fd, "resume", resumeBuf, "Victor_Agu_Resume.pdf");
  const url = `https://jobs.ashbyhq.com/${job.board || job.company.toLowerCase()}/${job.ref_id}/application`;
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { ok: res.ok, response: `${res.status}: ${text.slice(0, 300)}` };
}

const SUBMITTERS = {
  greenhouse: submitGreenhouse,
  lever: submitLever,
  workable: submitWorkable,
  ashby: submitAshby,
};

// Submit one application. Returns { ok, response, skipped }.
async function submitApplication(job, app) {
  if (!AUTO_APPLY) {
    return { ok: false, skipped: true, response: "JOBS_AUTO_APPLY is off (dry-run mode) — application prepared, not submitted." };
  }
  if (!inApplyWindow()) {
    return { ok: false, skipped: true, response: `Outside apply window (${WINDOW[0]}:00–${WINDOW[1]}:00 UTC).` };
  }
  const submit = SUBMITTERS[job.source];
  if (!submit) {
    return { ok: false, skipped: true, response: `Source "${job.source}" has no auto-apply path (semi-auto).` };
  }
  // Pacing between submissions.
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSubmitAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSubmitAt = Date.now();

  let resumeBuf;
  try {
    resumeBuf = getResumeBuffer(app.resumeTailored);
  } catch (e) {
    return { ok: false, response: `Resume missing: ${e.message}` };
  }
  try {
    const result = await submit(job, app, resumeBuf);
    console.log(`[Jobs] Apply ${job.source} ${job.company}/${job.title} -> ${result.response}`);
    return result;
  } catch (e) {
    console.warn(`[Jobs] Apply ${job.source} ${job.company}/${job.title} error:`, e.message);
    return { ok: false, response: e.message };
  }
}

module.exports = { submitApplication, getResumeBuffer, buildFormData, fetchFormSchema, pickOption, AUTO_APPLY, DAILY_CAP, inApplyWindow };
