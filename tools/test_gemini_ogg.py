# Converts the public speech WAV to OGG/Opus using the bundled ffmpeg,
# then tests whether Gemini accepts the OGG directly (like a Telegram voice note).
import subprocess, sys, base64, os, urllib.request
import imageio_ffmpeg

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
print("ffmpeg:", ffmpeg)

tmp = os.path.join(os.environ["TEMP"], "voice_test")
os.makedirs(tmp, exist_ok=True)
wav = os.path.join(tmp, "sample.wav")
ogg = os.path.join(tmp, "sample.ogg")

print("Downloading sample...")
import requests
with requests.get(
    "https://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0010_8k.wav",
    headers={"User-Agent": "Mozilla/5.0"}, timeout=60,
) as r:
    r.raise_for_status()
    open(wav, "wb").write(r.content)

print("Converting to OGG/Opus...")
subprocess.run(
    [ffmpeg, "-y", "-i", wav, "-c:a", "libopus", "-ar", "16000", "-ac", "1", ogg],
    check=True, capture_output=True,
)
size = os.path.getsize(ogg)
print(f"OGG size: {size} bytes")

# Read GROQ/GEMINI key from .env
env = {}
with open(r"c:\Users\hp\forchi\.env", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
keys = [k for k in env.get("GEMINI_KEYS", "").split(",") if k.startswith("AQ.")]
print("AQ keys:", len(keys))

data = open(ogg, "rb").read()
b64 = base64.b64encode(data).decode()

# Test Gemini with OGG directly
import json, urllib.request

body = {
    "contents": [{
        "role": "user",
        "parts": [
            {"inline_data": {"mime_type": "audio/ogg", "data": b64}},
            {"text": "Transcribe the audio exactly as spoken. Output only the transcription, no commentary."},
        ],
    }]
}
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
req = urllib.request.Request(
    url,
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "x-goog-api-key": keys[0]},
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.load(r)
    text = resp["candidates"][0]["content"]["parts"][0]["text"]
    print("\n✅ Gemini accepted OGG/Opus directly. Transcription:")
    print(text[:400])
except urllib.error.HTTPError as e:
    print("\n❌ Gemini rejected OGG:", e.code)
    print(e.read().decode()[:500])
