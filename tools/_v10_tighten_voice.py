"""Temp: measure silence in the clean-voice scene wavs, then tighten pauses and report
before/after durations. No re-render needed if it's mostly long pauses."""
import os, sys, wave, struct, subprocess, re, shutil
import imageio_ffmpeg

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "tools"))
from _v10_voice import tighten_silences
FF = imageio_ffmpeg.get_ffmpeg_exe()
DIR = os.path.join(BASE, "temp_media", "v10_repl_voice")
if "--dir" in sys.argv:
    DIR = sys.argv[sys.argv.index("--dir") + 1]

def dur(p):
    r = subprocess.run([FF, "-i", p], capture_output=True, text=True, errors="ignore")
    m = re.search(r"Duration:\s*([\d:.]+)", r.stderr)
    if not m: return 0.0
    h, mm, s = m.group(1).split(":")
    return float(h) * 3600 + float(mm) * 60 + float(s)

def silence_frac(p):
    try:
        with wave.open(p, 'rb') as w:
            sr = w.getframerate(); n = w.getnframes()
            raw = w.readframes(n)
        samples = struct.unpack(f'<{n}h', raw)
        thr = int(0.02 * 32767)
        sil = sum(1 for s in samples if abs(s) < thr)
        return sil / n
    except Exception:
        return None

before_tot = after_tot = 0.0
for i in range(1, 22):
    p = os.path.join(DIR, f"r{i:02d}.wav")
    if not os.path.exists(p): continue
    d0 = dur(p); sf = silence_frac(p)
    before_tot += d0
    # PACING CHANGE (2026-09-05, user directive): was max_sil=0.45 (too much dead
    # air -> "the voice pauses a lot"). 0.20 keeps natural micro-pauses while
    # removing the audible sentence gaps -> ~185-195 wpm energetic documentary flow.
    tighten_silences(p, max_sil=0.20, lead=0.02, tail=0.05)
    d1 = dur(p); after_tot += d1
    print(f"r{i:02d}: {d0:.1f}s silence%={sf:.0%} -> {d1:.1f}s")
print(f"TOTAL: {before_tot:.1f}s -> {after_tot:.1f}s")

# VOICE-CONSISTENCY (2026-09-06 user directive): equalize per-scene loudness so the
# "voice waves" (level changes scene-to-scene) stop. Measure speech-RMS per scene,
# then gain each scene toward the group median (bounded so we never pump noise).
import math, statistics
def speech_rms(p):
    try:
        with wave.open(p, 'rb') as w:
            n = w.getnframes(); raw = w.readframes(n)
            sw = w.getsampwidth()
        if sw != 2 or n == 0:
            return None
        samples = struct.unpack(f'<{n}h', raw)
        sp = [abs(x) for x in samples if abs(x) > int(0.01 * 32767)]
        if not sp:
            return None
        return (sum(x * x for x in sp) / len(sp)) ** 0.5 / 32767.0
    except Exception:
        return None
paths = [os.path.join(DIR, f"r{i:02d}.wav") for i in range(1, 22) if os.path.exists(os.path.join(DIR, f"r{i:02d}.wav"))]
rms = {p: v for p in paths if (v := speech_rms(p)) and v > 1e-4}
if len(rms) >= 2:
    target = statistics.median(rms.values())
    for p, v in rms.items():
        gdb = 20 * math.log10(target / max(v, 1e-6))
        gdb = max(-6.0, min(6.0, gdb))
        if abs(gdb) < 0.5:
            continue
        tmp = p + ".eq.wav"
        r = subprocess.run([FF, "-y", "-i", p, "-af", f"volume={gdb:.2f}dB",
                            "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", tmp],
                           capture_output=True)
        if r.returncode == 0 and os.path.exists(tmp):
            os.replace(tmp, p)
            print(f"eq {os.path.basename(p)}: {gdb:+.1f}dB -> median loudness")
    print(f"[voice-eq] equalized {len(rms)} scenes to a constant loudness")

