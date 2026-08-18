// Temp: test Gmail SMTP send with the app password (to agumoorewe@gmail.com).
require("dotenv").config();
const nodemailer = require("nodemailer");

(async () => {
  const user = process.env.SMTP_USER || process.env.EMAIL_TO || "agumoorewe@gmail.com";
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const to = process.env.EMAIL_TO || "agumoorewe@gmail.com";
  console.log("user:", user, "| to:", to, "| pass len:", pass.length);

  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass },
  });

  try {
    const info = await t.sendMail({
      from: `"ForChi Jobs" <${user}>`,
      to,
      subject: "ForChi email test ✅",
      text: "This is a test from ForChi. Gmail SMTP is configured and working.",
    });
    console.log("✅ SENT:", info.messageId, "| response:", info.response.slice(0, 60));
  } catch (e) {
    console.log("❌ FAILED:", e.message.slice(0, 300));
    if (/Invalid login|auth/i.test(e.message)) {
      console.log("→ The app password does NOT belong to " + user + ". If it belongs to yonkkalu@gmail.com, set SMTP_USER=yonkkalu@gmail.com.");
    }
    process.exit(1);
  }
})();
