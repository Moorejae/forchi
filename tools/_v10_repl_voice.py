"""V10 replication voice — edge-tts (NON-clone, clean neural narrator).

Voice: en-US-ChristopherNeural ("Reliable, Authority"), rate tuned to match the
reference narrator's ~135 WPM delivery. Renders each scene's exact narration.

Usage:
    .venv\\Scripts\\python.exe tools/_v10_repl_voice.py [--rate -15%] [--limit N]
"""
import os, sys, json, asyncio, subprocess, re, shutil
import edge_tts
import imageio_ffmpeg
from _paths import BASE

FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "en-US-BrianNeural"  # Gemini-ranked 90/100 match to the reference narrator
PITCH = "-10Hz"  # lighter per user: less heavy than -20Hz

# Higgs baked-in voices (space slymun/higgs-tts3). Default = Victor Moore (clean) with
# speed_slow only — USER-PICKED (2026-08-27) over the V10 Narrator (whispery) and the
# deep clone. Full voice, less whisper, established ForChi persona.
HIGGS_VOICE = "Victor Moore (clean)"
HIGGS_TOKENS = "<|prosody:speed_slow|>"   # NO pitch_low (that's what made it robotic-deep)
HIGGS_SEED = 7  # varied from 1234 (1234 carried the r01 pitch-ramp latent artifact)

# lazy import gradio_client for Higgs mode
_client = None

def get_higgs_client():
    global _client
    if _client is None:
        from gradio_client import Client
        tok = ""
        env = os.path.join(BASE, ".env")
        if os.path.exists(env):
            for line in open(env, encoding="utf-8"):
                if line.startswith("HF_ACCESS_TOKEN=") or line.startswith("HF_TOKEN="):
                    tok = line.split("=", 1)[1].strip().strip('"').strip("'")
        _client = Client("slymun/higgs-tts3", headers={"Authorization": f"Bearer {tok}"})
    return _client

async def synth(text, out_mp3, rate):
    com = edge_tts.Communicate(text, VOICE, rate=rate, pitch=PITCH)
    await com.save(out_mp3)

def synth_higgs(text, out_wav, voice=HIGGS_VOICE, tokens=HIGGS_TOKENS, seed=HIGGS_SEED):
    """Render with the Higgs baked voice (returns the wav path)."""
    c = get_higgs_client()
    res = c.predict(
        tokens + text,
        voice, None, None,
        0.9, 0.95, 50, 4096, seed,
        api_name="/predict",
    )
    p = res if isinstance(res, str) else res[0]
    shutil.copy(p, out_wav)
    return out_wav

def to_wav(mp3, wav):
    subprocess.run([FF, "-y", "-i", mp3, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", wav],
                   capture_output=True, text=True, errors="ignore")

def probe_dur(p):
    r = subprocess.run([FF, "-i", p], capture_output=True, text=True, errors="ignore")
    m = re.search(r"Duration:\s*([\d:.]+)", r.stderr)
    if not m:
        return 0.0
    hh, mm, ss = m.group(1).split(":")
    return float(hh) * 3600 + float(mm) * 60 + float(ss)

def render(scenes, out_dir, rate="-12%", limit=None, clone=False, voice=HIGGS_VOICE, tokens=HIGGS_TOKENS, seed=HIGGS_SEED):
    """Render ONE continuous phrase PER SCENE (join non-empty shot texts in order,
    no repetition, no word splitting) -> r_{scene:02d}.wav. Natural flow.
    clone=True uses the Higgs space voice (voice/tokens/seed configurable)."""
    os.makedirs(out_dir, exist_ok=True)
    sel = scenes[:limit] if limit else scenes
    results = []
    total_words = 0
    for i, s in enumerate(sel, 1):
        full = " ".join(sh["text"] for sh in s["shots"] if sh.get("text") and sh["text"].strip()).strip()
        if not full:
            continue
        wav = os.path.join(out_dir, f"r{i:02d}.wav")
        if os.path.exists(wav) and os.path.getsize(wav) > 0:
            print(f"  [replvoice] scene {i} cached")
        else:
            if clone:
                synth_higgs(full, wav, voice=voice, tokens=tokens, seed=seed)
            else:
                mp3 = os.path.join(out_dir, f"r{i:02d}.mp3")
                asyncio.run(synth(full, mp3, rate))
                to_wav(mp3, wav)
                if os.path.exists(mp3):
                    os.remove(mp3)
            print(f"  [replvoice] scene {i} done")
        total_words += len(full.split())
        results.append({"index": i, "wav": wav, "dur": probe_dur(wav)})
    total = sum(r["dur"] for r in results)
    wpm = int(total_words / (total / 60)) if total > 0 else 0
    print(f"  [replvoice] {len(results)} continuous phrases, narration total {total:.1f}s, "
          f"avg {wpm} wpm (natural flow, no repetition)")
    return results

if __name__ == "__main__":
    manifest = os.path.join(BASE, "temp_media", "v10_replication3.json")
    out_dir = os.path.join(BASE, "temp_media", "v10_repl_voice")
    rate = "-12%"
    limit = None
    clone = "--clone" in sys.argv
    voice = HIGGS_VOICE
    tokens = HIGGS_TOKENS
    seed = HIGGS_SEED
    if "--rate" in sys.argv:
        rate = sys.argv[sys.argv.index("--rate") + 1]
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    if "--voice" in sys.argv:
        voice = sys.argv[sys.argv.index("--voice") + 1]
    if "--prosody" in sys.argv:
        tokens = sys.argv[sys.argv.index("--prosody") + 1]
    if "--seed" in sys.argv:
        seed = int(sys.argv[sys.argv.index("--seed") + 1])
    if "--manifest" in sys.argv:
        manifest = sys.argv[sys.argv.index("--manifest") + 1]
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]
    with open(manifest, encoding="utf-8") as f:
        scenes = json.load(f)["scenes"]
    render(scenes, out_dir, rate=rate, limit=limit, clone=clone, voice=voice, tokens=tokens, seed=seed)
