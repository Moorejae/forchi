// Replicates the bot's exact Gemini transcription call against a real speech sample
// to diagnose why voice transcription fails.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { GoogleGenerativeAI } = require("@google/generative-ai");

const SAMPLE = "https://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0010_8k.wav";

(async () => {
  console.log("Downloading sample speech WAV...");
  const res = await fetch(SAMPLE);
  console.log("Download status:", res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("WAV size:", buf.length, "bytes");

  const keys = (process.env.GEMINI_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  console.log("Gemini keys (AQ.*):", keys.filter((k) => k.startsWith("AQ.")).length, "/", keys.length);

  const t0 = Date.now();
  const genAI = new GoogleGenerativeAI(keys[0]);
  const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

  try {
    const result = await model.generateContent([
      { inlineData: { mimeType: "audio/wav", data: buf.toString("base64") } },
      { text: "Transcribe the audio exactly as spoken. Output only the transcription, no commentary." },
    ]);
    const text = result.response.text();
    console.log(`\n✅ Transcription in ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
    console.log(JSON.stringify(text));
  } catch (err) {
    console.log("\n❌ Gemini transcription FAILED:", err.message);
    console.log("Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
  }
  process.exit(0);
})();
