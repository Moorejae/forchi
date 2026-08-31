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
    tighten_silences(p, max_sil=0.45, lead=0.05, tail=0.10)
    d1 = dur(p); after_tot += d1
    print(f"r{i:02d}: {d0:.1f}s silence%={sf:.0%} -> {d1:.1f}s")
print(f"TOTAL: {before_tot:.1f}s -> {after_tot:.1f}s")
