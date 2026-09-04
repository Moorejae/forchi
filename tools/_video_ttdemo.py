"""ForChi TikTok demo helper - build a short (~10s) NO-VOICE video from 1-2 clips.

Picks 2 random usable clip segments from media/clips/manifest.json, concatenates
them (1080x1920, 30fps, no audio) into a ~10s mp4. Fast + reliable - perfect for
the TikTok review demo where you just need to show the Content Posting API
publishing a video, without waiting on script/voice generation.
"""
import os, sys, json, random, subprocess, shutil

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.environ.get("FORCHI_BASE") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.environ.get("FORCHI_BASE"):
    BASE = os.environ["FORCHI_BASE"]

FF = (os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg") or "ffmpeg")
MANIFEST = os.path.join(BASE, "media", "clips", "manifest.json")
SEGMENTS = os.path.join(BASE, "media", "clips", "segments")

TARGET_SEC = 10.0   # ~10s total


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "ttdemo"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else random.randint(0, 99999)
    random.seed(seed)

    with open(MANIFEST, encoding="utf-8") as f:
        entries = json.load(f)
    pool = [e for e in entries if e.get("usable") and os.path.exists(os.path.join(SEGMENTS, e["file"]))]
    if not pool:
        print("no usable clips", flush=True)
        return 1
    random.shuffle(pool)

    # pick 1-2 clips (2 if we have enough, else 1)
    n = 2 if len(pool) >= 2 else 1
    chosen = pool[:n]
    print(f"[ttdemo] {n} clips, seed={seed}", flush=True)

    # build a concat file and assemble
    work = os.path.join(BASE, "temp_media", name + "_ttbuild")
    os.makedirs(work, exist_ok=True)
    segs = []
    for i, c in enumerate(chosen):
        src = os.path.join(SEGMENTS, c["file"])
        seg = os.path.join(work, f"seg{i}.mp4")
        subprocess.run(
            [FF, "-y", "-stream_loop", "-1", "-i", src, "-t", f"{TARGET_SEC/n:.2f}",
             "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p",
             "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", seg],
            capture_output=True)
        segs.append(seg)
        print(f"[ttdemo] seg {i} {c['file']}", flush=True)

    vlist = os.path.join(work, "vlist.txt")
    with open(vlist, "w") as f:
        for s in segs:
            f.write(f"file '{s}'\n")
    vcat = os.path.join(work, "vcat.mp4")
    subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", vlist, "-c", "copy", vcat],
                   capture_output=True)

    out = os.path.join(BASE, "temp_media", name + ".mp4")
    subprocess.run(
        [FF, "-y", "-i", vcat, "-t", f"{TARGET_SEC:.2f}", "-c:v", "libx264", "-crf", "19",
         "-preset", "veryfast", "-an", "-c:a", "aac", "-b:a", "0", out],
        capture_output=True)
    if os.path.exists(out):
        print(f"[ttdemo] WROTE {out} {os.path.getsize(out)//1024}KB", flush=True)
        print(f"[ttdemo] OUTPUT={out}", flush=True)
        return 0
    print("[ttdemo] FAILED", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
