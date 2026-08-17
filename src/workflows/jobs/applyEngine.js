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
      const chunks = [];
      return new Promise((resolve) => {
        const doc = new PDFDocument({ size: "LETTER", margin: 48 });
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));

        doc.registerFont("Carlito-Regular", F.regular);
        doc.registerFont("Carlito-Bold", F.bold);
        doc.registerFont("Carlito-Italic", F.italic);
        doc.registerFont("Carlito-BoldItalic", F.boldItalic);

        const ACCENT = "#1F3864";
        const GRAY = "#555555";
        const DARK = "#1a1a1a";
        const margin = 48;
        const width = doc.page.width - margin * 2;

        const lines = String(tailoredText).split("\n").map((l) => cleanLine(l)).filter(Boolean);

        // ── Header: name / title / contact ──
        const name = lines[0] || "Agu Victor Chiedozie";
        const title = lines[1] || "";
        const contact = lines[2] || "";
        const bodyLines = lines.slice(3);

        doc.font("Carlito-Bold").fontSize(18).fillColor(ACCENT).text(name.toUpperCase());
        if (title) doc.moveDown(0.2).font("Carlito-Regular").fontSize(11.5).fillColor(DARK).text(title);
        if (contact) doc.moveDown(0.2).font("Carlito-Regular").fontSize(8.5).fillColor(GRAY).text(contact);
        doc.moveDown(0.5);
        doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).lineWidth(1.3).strokeColor(ACCENT).stroke();
        doc.moveDown(1);

        // ── Sections ──
        for (const line of bodyLines) {
          if (isSectionHeading(line)) {
            doc.moveDown(0.7);
            doc.font("Carlito-Bold").fontSize(10.5).fillColor(ACCENT).text(line.toUpperCase());
            doc.moveDown(0.1);
            doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).lineWidth(0.6).strokeColor(ACCENT).opacity(0.6).stroke().opacity(1);
            doc.moveDown(0.55);
            continue;
          }
          if (isProjectHeader(line)) {
            doc.moveDown(0.4);
            doc.font("Carlito-Bold").fontSize(10).fillColor(DARK).text(line);
            doc.moveDown(0.12);
            continue;
          }
          const bullet = /^[-•*]/.test(line);
          const text = bullet ? line.replace(/^[-•*]\s*/, "") : line;
          doc.font("Carlito-Regular").fontSize(9.5).fillColor(DARK);
          doc.text(bullet ? `•  ${text}` : text, { lineGap: 1, paragraphGap: 2.5, indent: bullet ? 11 : 0 });
          doc.moveDown(0.1);
        }

        doc.end();
      });
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

// ── Greenhouse ───────────────────────────────────────────────────────────────
async function submitGreenhouse(job, app, resumeBuf) {
  const fd = new FormData();
  fd.append("first_name", PROFILE.identity.firstName);
  fd.append("last_name", PROFILE.identity.lastName);
  fd.append("email", PROFILE.identity.email);
  fd.append("phone", PROFILE.identity.phone || "");
  fd.append("cover_letter", app.coverLetter || "");
  fdAppendFile(fd, "resume", resumeBuf, "Victor_Agu_Resume.pdf");
  const url = `https://boards-api.greenhouse.io/v1/boards/${job.board || job.company.toLowerCase()}/jobs/${job.ref_id}/application`;
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { ok: res.ok, response: `${res.status}: ${text.slice(0, 300)}` };
}

// ── Lever ────────────────────────────────────────────────────────────────────
async function submitLever(job, app, resumeBuf) {
  const fd = new FormData();
  fd.append("name", PROFILE.identity.fullName);
  fd.append("email", PROFILE.identity.email);
  fd.append("phone", PROFILE.identity.phone || "");
  fd.append("org", PROFILE.identity.location || "");
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
  fd.append("name", PROFILE.identity.fullName);
  fd.append("email", PROFILE.identity.email);
  fd.append("phone", PROFILE.identity.phone || "");
  fd.append("cover_letter", app.coverLetter || "");
  fdAppendFile(fd, "resume", resumeBuf, "Victor_Agu_Resume.pdf");
  const url = `https://apply.workable.com/api/v3/accounts/${job.board || job.company.toLowerCase()}/jobs/${job.ref_id}/apply`;
  const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  return { ok: res.ok, response: `${res.status}: ${text.slice(0, 300)}` };
}

// ── Ashby ────────────────────────────────────────────────────────────────────
async function submitAshby(job, app, resumeBuf) {
  const fd = new FormData();
  fd.append("name", PROFILE.identity.fullName);
  fd.append("email", PROFILE.identity.email);
  fd.append("phone", PROFILE.identity.phone || "");
  fd.append("comments", app.coverLetter || "");
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

module.exports = { submitApplication, getResumeBuffer, AUTO_APPLY, DAILY_CAP, inApplyWindow };
