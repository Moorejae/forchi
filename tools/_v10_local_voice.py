#!/usr/bin/env python3
"""V10 voice via the LOCAL Contabo worker (VPS-native path).

When the pipeline runs ON the VPS, SSH-ing to 217.77.1.187 to submit voice is
wrong (the VPS IS the worker host, and _v10_contabo_voice.py hardcodes a Windows
BASE path -> it can't read .env -> exits -> the pipeline falls back to Higgs and
then a missing _v10_repl_voice.py). Instead this tool runs the worker's
synth_manifest() IN-PROCESS on the local worker — same quality, no network.

Usage:
    python tools/_v10_local_voice.py <manifest.json> <local_voice_dir>
"""
import os, sys, json, time, hashlib, shutil, subprocess

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(name, default=""):
    try:
        with open(os.path.join(BASE, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return os.environ.get(name, default)


def _voice_interpreter():
    """The VPS voice worker runs from /opt/voice with its OWN venv (has f5_tts).
    The pipeline venv (/opt/forchi/.venv) does NOT. If we can't import f5_tts,
    re-exec this script under /opt/voice/venv/bin/python with the worker env."""
    candidates = [
        "/opt/voice/venv/bin/python",
        "/opt/voice/venv/bin/python3",
    ]
    for py in candidates:
        if os.path.exists(py):
            try:
                r = subprocess.run([py, "-c", "import f5_tts"], capture_output=True, text=True, timeout=30)
                if r.returncode == 0:
                    return py
            except Exception:
                pass
    return None


def main():
    if len(sys.argv) < 3:
        print("usage: python tools/_v10_local_voice.py <manifest.json> <voice_dir>", file=sys.stderr)
        return 1
    manifest_path, voice_dir = sys.argv[1], sys.argv[2]
    if not os.path.exists(manifest_path):
        print(f"manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    # Relaunch under the voice venv if this interpreter lacks f5_tts.
    try:
        import f5_tts  # noqa: F401
    except Exception:
        vpy = _voice_interpreter()
        if vpy:
            print(f"[localvoice] relaunching under {vpy} (has f5_tts)", flush=True)
            envmap = dict(os.environ)
            envmap.update({
                "VOICE_MODEL_DIR": env("VOICE_MODEL_DIR", "/opt/voice/f5-tts"),
                "VOICE_REF_WAV": env("VOICE_REF_WAV", "/opt/voice/f5-tts/ref.wav"),
                "VOICE_REF_TEXT_FILE": env("VOICE_REF_TEXT_FILE", "/opt/voice/f5-tts/ref.txt"),
                "VOICE_OUT_DIR": env("VOICE_OUT_DIR", "/opt/voice/out"),
                "VOICE_JOBS_DIR": env("VOICE_JOBS_DIR", "/opt/voice/jobs"),
                "VOICE_THREADS": env("VOICE_THREADS", "2"),
                "VOICE_NFE_STEP": env("VOICE_NFE_STEP", "16"),
                "VOICE_WORKERS": env("VOICE_WORKERS", "2"),
                "HF_HOME": env("HF_HOME", "/opt/voice/hf-cache"),
            })
            r = subprocess.run([vpy, os.path.abspath(__file__), manifest_path, voice_dir], env=envmap)
            return r.returncode
        print("[localvoice] f5_tts unavailable and no voice venv found", file=sys.stderr)
        return 1

    # Mirror the worker's deterministic job-id scheme (content hash of manifest)
    # so a re-run reuses the same out subdir and skips already-rendered scenes.
    content = open(manifest_path, "rb").read()
    job_id = hashlib.sha1(content).hexdigest()[:12]
    out_dir = env("VOICE_OUT_DIR", "/opt/voice/out")
    job_sub = os.path.join(out_dir, job_id)
    os.makedirs(job_sub, exist_ok=True)

    print(f"[localvoice] rendering manifest -> {job_sub}", flush=True)
    # Run the worker's synth_manifest in-process (same F5-TTS engine).
    sys.path.insert(0, BASE)
    from voice_synthesizer import synth_manifest
    t0 = time.time()
    synth_manifest(manifest_path, job_sub)
    print(f"[localvoice] done in {round(time.time() - t0)}s -> {job_sub}", flush=True)

    # Copy rNN.wav into the pipeline's voice dir (flatten, like _contabo_voice does).
    os.makedirs(voice_dir, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(job_sub)):
        if f.startswith("r") and f.endswith(".wav") and os.path.getsize(os.path.join(job_sub, f)) > 0:
            shutil.copy(os.path.join(job_sub, f), os.path.join(voice_dir, f))
            n += 1
    print(f"[localvoice] copied {n} wavs -> {voice_dir}", flush=True)
    return 0 if n > 0 else 1


if __name__ == "__main__":
    sys.exit(main())

