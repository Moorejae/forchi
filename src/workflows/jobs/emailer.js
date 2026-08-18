// Emailer: for SEMI-AUTO matches (jobs that can't be auto-submitted: LinkedIn,
// aggregator feeds, remote boards), send ONE email per job to the user with:
//   - the job link
//   - the tailored cover letter (in the body)
//   - the tailored resume (PDF attachment)
// The user opens the link, taps apply, and has the letter + resume ready.
//
// Config (env):
//   EMAIL_TO        default yonkkalu@gmail.com
//   SMTP_HOST       default smtp.gmail.com
//   SMTP_PORT       default 587
//   SMTP_USER       default EMAIL_TO
//   SMTP_PASS       Gmail App Password (2FA required) — required to send.
const nodemailer = require("nodemailer");
const { getResumeBuffer } = require("./applyEngine");

const TO = process.env.EMAIL_TO || "agumoorewe@gmail.com";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || TO;
// Gmail app passwords are 4 groups of 4 with spaces — strip them.
const SMTP_PASS = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

function configured() {
  return !!(SMTP_PASS && SMTP_HOST && SMTP_USER);
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
  if (resumeTailored && resumeTailored.length > 100) {
    try { resumePdf = await getResumeBuffer(resumeTailored); }
    catch (e) { console.warn("[JobsEmail] resume PDF failed:", e.message); }
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
    "",
    "────────────────────────────",
    "TAILORED COVER LETTER",
    "────────────────────────────",
    "",
    coverLetter || "(none)",
    "",
    resumePdf ? "Your tailored resume is attached as a PDF." : "Resume PDF unavailable.",
    "",
    "— ForChi Jobs",
  ].join("\n");
  const mail = {
    from: `"ForChi Jobs" <${SMTP_USER}>`,
    to: TO,
    subject,
    text,
    attachments: resumePdf
      ? [{ filename: `Agu_Victor_Resume_${safeName(job.company)}.pdf`, content: resumePdf }]
      : [],
  };

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

module.exports = { sendMatchEmail, configured };
