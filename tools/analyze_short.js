// Temp: analyze a downloaded YouTube Short — audio (transcript + voice) and video (visuals).
require("dotenv").config();
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const KEYS = (process.env.GEMINI_KEYS || "").split(",").map((k) => k.trim()).filter((k) => k.startsWith("AQ."));
const genAI = new GoogleGenerativeAI(KEYS[0]);
const AUDIO = "temp_media/short_QRbzAJCVWpQ.webm";
const VIDEO = "temp_media/shortvid_QRbzAJCVWpQ.mp4";

async function call(modelId, parts) {
  const model = genAI.getGenerativeModel({ model: modelId });
  const r = await model.generateContent({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } });
  return r.response.text().trim();
}

(async () => {
  // ── A) AUDIO: transcript + voice character ──
  const audioBuf = fs.readFileSync(AUDIO);
  console.log("=== AUDIO ANALYSIS ===");
  try {
    const a = await call("gemini-3.6-flash", [
      { inlineData: { mimeType: "audio/webm", data: audioBuf.toString("base64") } },
      { text: "This is the audio of a YouTube Short. Do three things:\n1) TRANSCRIPT: transcribe the spoken words exactly, word for word, in order.\n2) VOICE: describe the voice precisely — pace (slow/normal/fast + approx words per minute), pitch, tone, emotional register, whether it sounds like a deliberate 'slow voice of reason', and how the delivery matches the meaning of the words.\n3) MUSIC: is there background music? describe its mood.\nLabel each section clearly." },
    ]);
    console.log(a);
  } catch (e) { console.log("audio err:", e.message); }

  // ── B) VIDEO: visuals / stitching / captions ──
  const videoBuf = fs.readFileSync(VIDEO);
  console.log("\n=== VIDEO ANALYSIS ===");
  const vModels = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite-image"];
  for (const vm of vModels) {
    try {
      const v = await call(vm, [
        { inlineData: { mimeType: "video/mp4", data: videoBuf.toString("base64") } },
        { text: "This is a vertical YouTube Short (no audio). Describe the visuals in detail:\n1) FOOTAGE TYPE: is it anime clips, animation, or something else? roughly how many distinct scenes/clips appear?\n2) EDITING: does it look like several different clips stitched together into one continuous video? how are cuts handled?\n3) TEXT: is there any on-screen text, captions, or subtitles? what style (font vibe, position, color)?\n4) OVERALL FEEL: colors, motion, how well the visuals fit a philosophical/poetic voiceover.\nBe concrete and specific." },
      ]);
      console.log(`(${vm})`);
      console.log(v);
      break;
    } catch (e) {
      console.log(`video model ${vm} err:`, e.message.slice(0, 120));
    }
  }
})();
