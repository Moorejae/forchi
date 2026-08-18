// Temp: verify the Resend API key by sending a test email over HTTPS.
require("dotenv").config();

(async () => {
  const key = (process.env.RESEND_API_KEY || "").trim();
  const to = process.env.EMAIL_TO || "agumoorewe@gmail.com";
  if (!key) { console.log("no RESEND_API_KEY"); process.exit(1); }
  console.log("key:", key.slice(0, 10) + "... | to:", to);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ForChi Jobs <onboarding@resend.dev>",
      to: [to],
      subject: "ForChi Resend test ✅",
      text: "Resend path works. Match emails are now live.",
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  console.log("status:", res.status);
  console.log("body:", body.slice(0, 200));
})();
