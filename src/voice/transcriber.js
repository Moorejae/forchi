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
async function transcribeWavWithGemini(wavBuffer) {
  const keys = getGeminiKeys();
  if (!keys.length) {
    throw new Error("No Gemini keys configured for voice transcription.");
  }

  console.log("[Voice Transcriber] Transcribing via Gemini (free)...");

  const genAI = new GoogleGenerativeAI(keys[0]);
  const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

  const result = await model.generateContent([
    { inlineData: { mimeType: "audio/wav", data: wavBuffer.toString("base64") } },
    { text: "Transcribe the audio exactly as spoken. Output only the transcription, no commentary." },
  ]);

  const text = result.response.text();
  return text.trim();
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
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const timestamp = Date.now();
  // Sanitize extension hint (fallback to ogg)
  const ext = (extHint || "ogg").replace(/[^a-zA-Z0-9]/g, "");
  const inputPath = path.join(tmpDir, `voice_${timestamp}.${ext}`);
  const wavPath = path.join(tmpDir, `voice_${timestamp}.wav`);

  try {
    console.log(`[Voice Engine] Downloading voice note...`);
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to download audio: HTTP ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(buffer));

    console.log(`[Voice Engine] Converting ${ext} to 16kHz mono WAV via ffmpeg...`);
    await convertAudioToWav(inputPath, wavPath);

    console.log(`[Voice Engine] Transcribing audio...`);
    const wavBuffer = fs.readFileSync(wavPath);

    // Tier 1: Gemini (free, uses working Gemini keys)
    try {
      const transcript = await transcribeWavWithGemini(wavBuffer);
      console.log(`[Voice Engine] Transcription result: "${transcript}"`);
      return transcript;
    } catch (err) {
      console.warn(`[Voice Engine] Gemini transcription failed: ${err.message} — trying HF Whisper...`);
    }

    // Tier 2: HF Whisper (requires HF credits)
    const transcript = await transcribeWavWithHF(wavBuffer);
    console.log(`[Voice Engine] Transcription result: "${transcript}"`);
    return transcript;
  } finally {
    // Clean up temporary audio files
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

module.exports = { processVoiceMessage };
