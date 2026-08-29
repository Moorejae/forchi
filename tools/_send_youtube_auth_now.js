// One-shot: email + Telegram-DM the YouTube re-consent URL immediately (manual trigger).
// The 48h pre-emptive warning is handled by authWatch.js on the running bot.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { consentUrl } = require("../src/workflows/video/youtube.js");

(async () => {
  const url = consentUrl();
  if (!url) { console.error("couldn't build consent URL (check YOUTUBE_CLIENT_ID / YOUTUBE_CALLBACK_URL)"); process.exit(1); }

  const text = `🎬 ForChi YouTube — re-authorize now\n\nMy YouTube access expires soon (unverified app, ~7-day token).\n\nClick to authorize (signed in as aguswigad@gmail.com — @sirxlud):\n${url}\n\nThen: Allow → Advanced → Go to forchi.onrender.com (unsafe) → Allow. You'll see the green "ForChi is connected to YouTube" page.`;

  // 1) Email via Resend
  const key = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  if (key && to) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "ForChi <onboarding@resend.dev>",
        to: [to],
        subject: "🎬 ForChi YouTube — re-authorize now",
        text,
      }),
    });
    console.log("email:", res.ok ? "SENT to " + to : "FAILED " + res.status + " " + (await res.text()).slice(0, 150));
  } else {
    console.warn("no RESEND_API_KEY/EMAIL_TO — skipped email");
  }

  // 2) Telegram DM
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  let chatId = process.env.JOBS_NOTIFY_CHAT_ID || "6514724034"; // known bot chat (VPS)
  if (!chatId) {
    try {
      const jf = path.join(__dirname, "..", "data", "jobs_notify.json");
      if (fs.existsSync(jf)) chatId = JSON.parse(fs.readFileSync(jf, "utf8")).chatId;
    } catch {}
  }
  if (botToken && chatId) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🎬 *YouTube re-auth needed*\n\nI've emailed you the one-click authorization link. Click it in your inbox (or use this):\n\n\`${url}\`\n\nThen Allow → Advanced → Go to forchi.onrender.com (unsafe) → Allow.`,
        parse_mode: "Markdown",
      }),
    });
    const j = await res.json().catch(() => ({}));
    console.log("telegram:", j.ok ? "SENT to chat " + chatId : "FAILED " + res.status + " " + JSON.stringify(j).slice(0, 150));
  } else {
    console.warn("no TELEGRAM_BOT_TOKEN/chat id — skipped telegram");
  }
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
