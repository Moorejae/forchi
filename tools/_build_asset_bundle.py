# Build a compressed, shippable asset bundle for the Render/HF deployment:
#   1. Re-encode the 99 usable clips 1080x1920 -> 720x1280 h264 crf23 (they get
#      re-encoded in the final video anyway, so this is free quality-wise) -> ~60% smaller
#   2. Copy .instrumental as-is (already small ogg)
#   3. Zip everything into media/assets_bundle.zip for HF upload + Render cold-boot pull
# Uses the bundled imageio-ffmpeg (no admin install needed).
import json
import os
import shutil
import subprocess
import sys
import zipfile

BASE = r"c:\Users\hp\forchi"
FFMPEG = os.path.join(
    BASE, ".venv", "Lib", "site-packages", "imageio_ffmpeg", "binaries", "ffmpeg-win-x86_64-v7.1.exe"
)
SEG_DIR = os.path.join(BASE, "media", "clips", "segments")
MANIFEST = os.path.join(BASE, "media", "clips", "manifest.json")
INSTR_DIR = os.path.join(BASE, ".instrumental")
OUT_CLIPS = os.path.join(BASE, "media", "clipbundle")
OUT_INSTR = os.path.join(BASE, "media", "musicbundle")
ZIP_PATH = os.path.join(BASE, "media", "assets_bundle.zip")
W = 720
H = 1280


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(" | ".join((r.stderr or r.stdout or "").strip().splitlines()[-4:]))


def reencode(src, dst):
    run([
        FFMPEG, "-y", "-i", src,
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
        "-r", "30", "-an", "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-movflags", "+faststart", dst,
    ])


def main():
    if not os.path.exists(FFMPEG):
        print("ffmpeg binary not found:", FFMPEG)
        return 1
    if not os.path.exists(MANIFEST):
        print("manifest missing:", MANIFEST)
        return 1
    os.makedirs(OUT_CLIPS, exist_ok=True)
    os.makedirs(OUT_INSTR, exist_ok=True)

    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    usable = [c for c in manifest if c.get("usable") and c.get("file")]
    print(f"re-encoding {len(usable)} clips -> {W}x{H} crf23 ...")
    done = 0
    for c in usable:
        src = os.path.join(SEG_DIR, os.path.basename(c["file"]))
        dst = os.path.join(OUT_CLIPS, os.path.basename(c["file"]))
        if os.path.exists(dst):
            done += 1
            continue
        try:
            reencode(src, dst)
            done += 1
            if done % 10 == 0:
                print(f"  {done}/{len(usable)} clips done")
        except Exception as e:
            print(f"  FAIL {os.path.basename(src)}: {e}")
    print(f"clips done: {done}/{len(usable)}")

    # copy instrumentals (already small)
    copied = 0
    for f in os.listdir(INSTR_DIR):
        if f.lower().endswith((".ogg", ".mp3", ".wav", ".m4a")):
            shutil.copy2(os.path.join(INSTR_DIR, f), os.path.join(OUT_INSTR, f))
            copied += 1
    print(f"instrumentals copied: {copied}")

    # zip
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_STORED) as z:
        for root, _, files in os.walk(OUT_CLIPS):
            for f in files:
                z.write(os.path.join(root, f), os.path.join("clips", f))
        for root, _, files in os.walk(OUT_INSTR):
            for f in files:
                z.write(os.path.join(root, f), os.path.join("music", f))
    print(f"bundle: {ZIP_PATH} ({os.path.getsize(ZIP_PATH)/1048576:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
