// Uses the already-downloaded sample WAV, converts to OGG/Opus with bundled ffmpeg,
// and tests whether Gemini accepts the OGG directly (mirrors a Telegram voice note).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { execFile } = require("child_process");
const util = require("util");
const fs = require("fs");
const os = require("os");
const path = require("path");
const execFileP = util.promisify(execFile);

const FFMPEG = "C:\\Users\\hp\\AppData\\Roaming\\Python\\Python314\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe";
const wav = path.join(os.tmpdir(), "sample.wav");
const ogg = path.join(os.tmpdir(), "sample.ogg");

(async () => {
  if (!fs.existsSync(wav)) throw new Error("sample.wav missing — run curl download first");
  console.log("Converting WAV -> OGG/Opus...");
  await execFileP(FFMPEG, ["-y", "-i", wav, "-c:a", "libopus", "-ar", "16000", "-ac", "1", ogg]);
  console.log("OGG size:", fs.statSync(ogg).size, "bytes");

  const keys = (process.env.GEMINI_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  const b64 = fs.readFileSync(ogg).toString("base64");

  const body = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: "audio/ogg", data: b64 } },
        { text: "Transcribe the audio exactly as spoken. Output only the transcription, no commentary." },
      ],
    }],
  };

  console.log("Sending OGG to Gemini (gemini-3.5-flash-lite)...");
  const t0 = Date.now();
  const gr = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": keys[0] },
      body: JSON.stringify(body),
    }
  );
  const gjson = await gr.json();
  if (!gr.ok) {
    console.log("❌ Gemini rejected OGG:", gr.status, JSON.stringify(gjson).slice(0, 400));
  } else {
    const text = gjson.candidates?.[0]?.content?.parts?.[0]?.text || "(empty)";
    console.log(`✅ Gemini accepted OGG/Opus directly in ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
    console.log(text.slice(0, 400));
  }
  process.exit(0);
})();
