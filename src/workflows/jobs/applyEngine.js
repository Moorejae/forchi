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

// Render a tailored resume PDF (pdfkit) if available; else fall back to the base resume.
function getResumeBuffer(tailoredText) {
  try {
    const PDFDocument = require("pdfkit");
    if (tailoredText && tailoredText.length > 100) {
      const chunks = [];
      return new Promise((resolve) => {
        const doc = new PDFDocument({ size: "A4", margin: 48 });
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.fontSize(10);
        for (const line of tailoredText.split("\n")) {
          const t = line.trim();
          if (!t) { doc.moveDown(0.4); continue; }
          if (/^(SUMMARY|SKILLS|PROJECTS|EXPERIENCE|CERTIFICATIONS)$/i.test(t)) {
            doc.moveDown(0.4).font("Helvetica-Bold").fontSize(12).text(t).font("Helvetica").fontSize(10);
          } else {
            doc.text(t);
          }
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
