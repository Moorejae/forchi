const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const execPromise = util.promisify(exec);

async function convertAudioToWav(inputPath, wavPath) {
  // Convert any audio (OGG/Opus/MP3/WebM) -> WAV 16kHz mono using ffmpeg (Section 6)
  const cmd = `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`;
  await execPromise(cmd);
}

function getGeminiKeys() {
  const raw = process.env.GEMINI_KEYS || "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean).filter((k) => k.startsWith("AQ."));
}

// ── Gemini transcription (free, uses working Gemini keys) ─────────────────────
// Sends the audio bytes directly with the correct mime type. Gemini natively
// accepts OGG/Opus, WAV, MP3, etc. — no ffmpeg needed for the common formats.
async function transcribeWithGemini(audioBuffer, mimeType) {
  const keys = getGeminiKeys();
  if (!keys.length) {
    throw new Error("No Gemini keys configured for voice transcription.");
  }

  console.log(`[Voice Transcriber] Transcribing via Gemini (${mimeType})...`);

  const genAI = new GoogleGenerativeAI(keys[0]);
  const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

  const result = await model.generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    { text: "Transcribe the audio exactly as spoken. Output only the transcription, no commentary." },
  ]);

  const text = result.response.text();
  return text.trim();
}

function mimeFor(ext) {
  const map = {
    ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
    wav: "audio/wav", mp3: "audio/mp3", m4a: "audio/mp4",
    aac: "audio/aac", flac: "audio/flac",
  };
  return map[(ext || "").toLowerCase()] || "audio/ogg";
}

// ── Fast free tier: Groq Whisper (whisper-large-v3-turbo) — needs GROQ_API_KEY ──
async function transcribeWithGroq(audioBuffer, ext) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set — skipping Groq Whisper tier.");

  console.log("[Voice Transcriber] Transcribing via Groq Whisper (free, very fast)...");

  const cleanExt = (ext || "ogg").replace(/[^a-zA-Z0-9]/g, "") || "ogg";
  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("file", new Blob([audioBuffer], { type: mimeFor(cleanExt) }), `voice.${cleanExt}`);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper API error (${res.status}): ${errText.substring(0, 200)}`);
  }
  const data = await res.json();
  return (data.text || "").trim();
}

// ── Fallback: HF Whisper (requires HF Inference credits) ──────────────────────
async function transcribeWavWithHF(wavBuffer) {
  const hfToken = process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN;
  if (!hfToken) {
    throw new Error("HF_TOKEN (or HF_ACCESS_TOKEN) is missing for Whisper fallback.");
  }

  console.log("[Whisper Transcriber] Sending audio to Hugging Face Whisper API...");

  const res = await fetch("https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken}`,
      "Content-Type": "audio/wav"
    },
    body: wavBuffer
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HF Whisper API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.text || data[0]?.text || "";
  return text.trim();
}

async function processVoiceMessage(fileUrl, extHint = "ogg") {
  const tmpDir = path.join(process.cwd(), "temp_media");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const ext = (extHint || "ogg").replace(/[^a-zA-Z0-9]/g, "") || "ogg";
  const inputPath = path.join(tmpDir, `voice_${timestamp}.${ext}`);
  const wavPath = path.join(tmpDir, `voice_${timestamp}.wav`);
  const errors = [];

  try {
    console.log(`[Voice Engine] Downloading voice note...`);
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Failed to download audio: HTTP ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, audioBuffer);
    console.log(`[Voice Engine] Downloaded ${audioBuffer.length} bytes (${ext})`);

    // Tier 1: Gemini with the ORIGINAL audio — no ffmpeg needed.
    // Telegram voice notes are OGG/Opus, which Gemini natively accepts.
    try {
      const transcript = await transcribeWithGemini(audioBuffer, mimeFor(ext));
      console.log(`[Voice Engine] ✅ Transcription: "${transcript}"`);
      return transcript;
    } catch (err) {
      errors.push(`Gemini(direct): ${err.message}`);
      console.warn(`[Voice Engine] Direct Gemini failed: ${err.message}`);
    }

    // Tier 2: ffmpeg -> 16kHz WAV, then Gemini again (covers odd container formats).
    try {
      console.log(`[Voice Engine] Converting ${ext} to 16kHz mono WAV via ffmpeg...`);
      await convertAudioToWav(inputPath, wavPath);
      const transcript = await transcribeWithGemini(fs.readFileSync(wavPath), "audio/wav");
      console.log(`[Voice Engine] ✅ Transcription (WAV): "${transcript}"`);
      return transcript;
    } catch (err) {
      errors.push(`Gemini(wav): ${err.message}`);
      console.warn(`[Voice Engine] WAV Gemini failed: ${err.message}`);
    }

    // Tier 3: Groq Whisper (free + very fast) — only runs if GROQ_API_KEY is set.
    try {
      const transcript = await transcribeWithGroq(audioBuffer, ext);
      console.log(`[Voice Engine] ✅ Transcription (Groq): "${transcript}"`);
      return transcript;
    } catch (err) {
      errors.push(`Groq: ${err.message}`);
      console.warn(`[Voice Engine] Groq failed: ${err.message}`);
    }

    // Tier 4: HF Whisper (requires inference credits) — only if ffmpeg produced a WAV.
    if (fs.existsSync(wavPath)) {
      try {
        const transcript = await transcribeWavWithHF(fs.readFileSync(wavPath));
        console.log(`[Voice Engine] ✅ Transcription (HF): "${transcript}"`);
        return transcript;
      } catch (err) {
        errors.push(`HF Whisper: ${err.message}`);
        console.warn(`[Voice Engine] HF Whisper failed: ${err.message}`);
      }
    }

    throw new Error("All transcription tiers failed. " + errors.join(" | "));
  } finally {
    // Clean up temporary audio files
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

module.exports = { processVoiceMessage };
