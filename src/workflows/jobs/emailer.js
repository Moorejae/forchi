// Emailer: for SEMI-AUTO matches (jobs that can't be auto-submitted: LinkedIn,
// aggregator feeds, remote boards), send ONE email per job to the user with:
//   - the job link
//   - the tailored cover letter (in the body)
//   - the tailored resume (PDF attachment)
// The user opens the link, taps apply, and has the letter + resume ready.
//
// SEND PATHS (in order):
//   1. RESEND (HTTPS API, port 443 — works on Render, which BLOCKS outbound
//      SMTP 587/465/2525). Requires RESEND_API_KEY (free at resend.com).
//   2. SMTP fallback (Gmail app password via SMTP_PASS) — works on hosts that
//      allow outbound SMTP; tried on ports 587 → 465 → 2525.
//
// Config (env):
//   EMAIL_TO         recipient, default agumoorewe@gmail.com
//   RESEND_API_KEY   Resend API key (preferred — HTTPS)
//   EMAIL_FROM       Resend from address (default uses Resend's onboarding@resend.dev)
//   SMTP_USER/PASS   Gmail SMTP fallback
const nodemailer = require("nodemailer");
const { getResumeBuffer, getCoverLetterBuffer } = require("./applyEngine");

const TO = process.env.EMAIL_TO || "agumoorewe@gmail.com";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_USER = process.env.SMTP_USER || TO;
// Gmail app passwords are 4 groups of 4 with spaces — strip them.
const SMTP_PASS = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
const RESEND_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM = process.env.EMAIL_FROM || "ForChi Jobs <onboarding@resend.dev>";

function configured() {
  return !!(RESEND_KEY || (SMTP_PASS && SMTP_HOST && SMTP_USER));
}

// Resend HTTPS API (port 443 — the only reliable outbound path on Render).
async function sendViaResend({ to, subject, text, resumePdf, coverLetterPdf, company }) {
  if (!RESEND_KEY) return false;
  const body = {
    from: FROM,
    to: [to],
    subject,
    text,
  };
  body.attachments = [];
  if (resumePdf) body.attachments.push({ filename: `Agu_Victor_Resume_${safeName(company)}.pdf`, content: resumePdf.toString("base64") });
  if (coverLetterPdf) body.attachments.push({ filename: `Agu_Victor_Cover_Letter_${safeName(company)}.pdf`, content: coverLetterPdf.toString("base64") });
  if (!body.attachments.length) delete body.attachments;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (res.ok) { console.log(`[JobsEmail] ✅ sent via Resend (${res.status})`); return true; }
  console.warn(`[JobsEmail] Resend failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  return false;
}

function safeName(s) {
  return String(s || "Company").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
}

// Send one email for a matched job. Returns true if sent.
async function sendMatchEmail(job, { coverLetter, resumeTailored }) {
  if (!configured()) {
    console.warn("[JobsEmail] SMTP_PASS not configured — skipping email (semi-auto match queued only).");
    return false;
  }
  // Try multiple SMTP ports in order — Render free tier blocks some outbound
  // ports (587 timed out), so fall through to 465 and 2525.
  const candidates = [
    { host: SMTP_HOST, port: 587, secure: false },
    { host: SMTP_HOST, port: 465, secure: true },
    { host: SMTP_HOST, port: 2525, secure: false },
  ];
  let resumePdf = null;
  let coverLetterPdf = null;
  if (resumeTailored && resumeTailored.length > 100) {
    try { resumePdf = await getResumeBuffer(resumeTailored); }
    catch (e) { console.warn("[JobsEmail] resume PDF failed:", e.message); }
  }
  if (coverLetter) {
    try { coverLetterPdf = await getCoverLetterBuffer(coverLetter); }
    catch (e) { console.warn("[JobsEmail] cover letter PDF failed:", e.message); }
  }

  const subject = `🎯 Job match: ${job.company} — ${job.title}`;
  const text = [
    "A new job matched your profile and is ready to apply:",
    "",
    `🏢 Company: ${job.company}`,
    `💼 Role: ${job.title}`,
    `📍 Location: ${job.location || "Remote"}`,
    `🗓 Posted: ${job.postedAt || "n/a"}`,
    `🔗 Apply here: ${job.url}`,
    job.companyUrl ? `🌐 Company website: ${job.companyUrl} (prefer applying here — a direct company-site application is far more likely to be seen by a real human than a LinkedIn/jobsite one)` : "",
    "",
    "────────────────────────────",
    "TAILORED COVER LETTER",
    "────────────────────────────",
    "",
    coverLetter || "(none)",
    "",
    resumePdf ? "Your tailored resume is attached as a PDF." : "Resume PDF unavailable.",
    coverLetterPdf ? "Your tailored cover letter is attached as a PDF too." : "",
    "",
    "— ForChi Jobs",
  ].join("\n");
  const attachments = [];
  if (resumePdf) attachments.push({ filename: `Agu_Victor_Resume_${safeName(job.company)}.pdf`, content: resumePdf });
  if (coverLetterPdf) attachments.push({ filename: `Agu_Victor_Cover_Letter_${safeName(job.company)}.pdf`, content: coverLetterPdf });
  const mail = {
    from: `"ForChi Jobs" <${SMTP_USER}>`,
    to: TO,
    subject,
    text,
    attachments,
  };

  // 1) Resend (HTTPS — the reliable path on Render).
  if (await sendViaResend({ to: TO, subject, text, resumePdf, coverLetterPdf, company: job.company })) return true;

  // 2) SMTP fallback (587 → 465 → 2525).
  let lastErr = null;
  for (const c of candidates) {
    try {
      const transporter = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        family: 4, // force IPv4 — Render free tier has no IPv6 (ENETUNREACH otherwise)
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      });
      await transporter.sendMail(mail);
      console.log(`[JobsEmail] ✅ emailed ${job.company} / ${job.title} -> ${TO} (port ${c.port})`);
      return true;
    } catch (e) {
      lastErr = e;
      console.warn(`[JobsEmail] port ${c.port} failed (${e.message.slice(0, 80)}) — trying next…`);
    }
  }
  console.warn(`[JobsEmail] ❌ failed ${job.company} / ${job.title}: ${lastErr ? lastErr.message : "no candidates"}`);
  return false;
}

// Send a short plain-text email (used by the TikTok auth watcher for re-consent
// links, where Telegram can mangle long URLs). Resend first, SMTP fallback.
async function sendSimpleEmail({ subject, text }) {
  if (!configured()) {
    console.warn("[Emailer] not configured — skipping simple email");
    return false;
  }
  if (await sendViaResend({ to: TO, subject, text })) return true;
  const candidates = [
    { host: SMTP_HOST, port: 587, secure: false },
    { host: SMTP_HOST, port: 465, secure: true },
    { host: SMTP_HOST, port: 2525, secure: false },
  ];
  const mail = { from: `"ForChi" <${SMTP_USER}>`, to: TO, subject, text };
  let lastErr = null;
  for (const c of candidates) {
    try {
      const transporter = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        family: 4,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      });
      await transporter.sendMail(mail);
      console.log(`[Emailer] ✅ simple email -> ${TO} (port ${c.port})`);
      return true;
    } catch (e) {
      lastErr = e;
      console.warn(`[Emailer] port ${c.port} failed (${e.message.slice(0, 80)}) — trying next…`);
    }
  }
  console.warn(`[Emailer] ❌ simple email failed: ${lastErr ? lastErr.message : "no candidates"}`);
  return false;
}

module.exports = { sendMatchEmail, sendSimpleEmail, configured };
