// Tests the Groq Whisper transcription path exactly as the bot calls it.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const os = require("os");
const path = require("path");

const ogg = path.join(os.tmpdir(), "sample.ogg");
if (!fs.existsSync(ogg)) {
  console.log("sample.ogg missing — generate it with test_gemini_ogg.js first");
  process.exit(1);
}

(async () => {
  const key = process.env.GROQ_API_KEY;
  console.log("GROQ_API_KEY:", key ? `set (${key.slice(0, 7)}...)` : "NOT SET");
  if (!key) process.exit(1);

  const audioBuffer = fs.readFileSync(ogg);
  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");

  const t0 = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  console.log("status:", res.status);
  const data = await res.json();
  if (!res.ok) {
    console.log("❌ Groq error:", JSON.stringify(data).slice(0, 400));
  } else {
    console.log(`✅ Groq Whisper transcribed in ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
    console.log(data.text);
  }
  process.exit(0);
})();
