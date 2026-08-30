#!/usr/bin/env python3
"""
voice_synthesizer.py — Always-on CPU voice worker for the Contabo VPS.

Runs 24/7 on CPU threads (no GPU). Uses f5-tts (PyTorch CPU) with the baked-in
Victor Moore reference clip — no GPU, no ZeroGPU, no Higgs.

VOICE PROFILE (no re-cloning — we reuse the pre-cloned Victor Moore reference):
    A .wav voice reference lives in VOICE_MODEL_DIR (ref.wav) + its transcript
    in VOICE_REF_TEXT.

ENV
---
    VOICE_MODEL_DIR=/opt/voice/f5-tts        # model dir
    VOICE_REF_WAV=$VOICE_MODEL_DIR/ref.wav   # Victor Moore reference clip (24k mono)
    VOICE_REF_TEXT="..."                     # transcript of the ref clip
    VOICE_OUT_DIR=/opt/voice/out
    VOICE_SR=24000

EXPECTED MODEL DIR LAYOUT (provision once on the VPS):
    $VOICE_MODEL_DIR/
        ref.wav                      # the Victor Moore reference (24k mono)
    python deps: pip install f5-tts soundfile

USAGE
-----
    python voice_synthesizer.py --check                 # verify deps + model files
    python voice_synthesizer.py --text "hello world"    # single-shot test -> VOICE_OUT_DIR
    python voice_synthesizer.py --manifest run/manifest.json --voice-dir run/voice  # V10 pipeline mode
    python voice_synthesizer.py --worker                # poll a jobs dir forever (background)

DEPLOYMENT (keep it running forever, no SSH needed after start)
    # tmux (simplest):
    tmux new -d -s voice "cd /opt/forchi && /opt/forchi/venv/bin/python voice_synthesizer.py --worker"

    # systemd (survives reboots):
    cat > /etc/systemd/system/voice-worker.service <<'EOF'
    [Unit]
    Description=ForChi CPU voice worker
    After=network.target

    [Service]
    WorkingDirectory=/opt/forchi
    ExecStart=/opt/forchi/venv/bin/python voice_synthesizer.py --worker
    Restart=always
    RestartSec=10
    EnvironmentFile=/opt/forchi/.env

    [Install]
    WantedBy=multi-user.target
    EOF
    systemctl daemon-reload && systemctl enable --now voice-worker
"""
import os, sys, json, time, argparse
from pathlib import Path


def env(name, default=""):
    return os.environ.get(name, default)


MODEL_DIR = env("VOICE_MODEL_DIR", "/opt/voice/f5-tts")
REF_WAV = env("VOICE_REF_WAV", os.path.join(MODEL_DIR, "ref.wav"))
REF_TEXT = env("VOICE_REF_TEXT", "")
# Multi-word transcripts are hard to pass via systemd Environment=, so also
# support VOICE_REF_TEXT_FILE (a file containing the ref transcript).
_rtf = env("VOICE_REF_TEXT_FILE", "")
if _rtf and os.path.exists(_rtf):
    REF_TEXT = open(_rtf, encoding="utf-8").read().strip()
OUT_DIR = env("VOICE_OUT_DIR", "/opt/voice/out")
SR = int(env("VOICE_SR", "24000"))

# f5-tts downloads its model weights to the HF cache on first use; cached per user.
_engine = None


def check():
    """Report dependency + ref-file status (no synthesis)."""
    ok = True
    print("[voice] --check")
    try:
        import torch
        print(f"  torch {torch.__version__} — cuda: {torch.cuda.is_available()}")
    except Exception as e:
        ok = False
        print(f"  ❌ torch missing: {e}")
    try:
        import f5_tts  # noqa
        print("  f5-tts package present")
    except Exception as e:
        print(f"  ❌ f5-tts package: {e}")
        ok = False
    try:
        import soundfile  # noqa
        print("  soundfile present")
    except Exception as e:
        print(f"  ❌ soundfile missing: {e}")
        ok = False
    print(f"  ref wav: {'✓' if os.path.exists(REF_WAV) else '❌ MISSING'} {REF_WAV}")
    if not os.path.exists(REF_WAV):
        ok = False
    return ok


def synthesize(text):
    """Render `text` to a wav path using F5-TTS on CPU. Returns the wav path."""
    global _engine
    # Use ALL cores (measured: the box has 4 vCPU; F5-TTS only used ~2.6 by default).
    try:
        import torch
        torch.set_num_threads(int(os.environ.get("VOICE_THREADS", str(max(1, os.cpu_count() or 4)))))
    except Exception:
        pass
    if _engine is None:
        from f5_tts.api import F5TTS
        _engine = F5TTS(device="cpu")
    out_wav = os.path.join(OUT_DIR, f"voice_{int(time.time()*1000)}.wav")
    _engine.infer(
        ref_file=REF_WAV,
        ref_text=REF_TEXT or None,
        gen_text=text,
        file_wave=out_wav,
        remove_silence=False,
        # Victor Moore tone (matches the Higgs default tuning)
        speed=0.85,
        seed=7,
        cfg_strength=2.0,
        # nfe_step is the dominant CPU cost (flow-matching steps).
        # 32 = reference-quality but ~6 min/scene; 16 = ~3 min/scene (halved).
        # Configurable via VOICE_NFE_STEP env for quality/speed tradeoff.
        nfe_step=int(os.environ.get("VOICE_NFE_STEP", "16")),
    )
    return out_wav


def _synth_worker(args):
    """One scene synthesis in a child process (own engine). Args tuple:
    (i, text, out_wav, ref_wav, ref_text, out_dir). Uses fewer threads per
    process so N parallel workers together use all cores."""
    i, text, out_wav, ref_wav, ref_text, out_dir = args
    global _engine
    try:
        import torch
        thr = int(os.environ.get("VOICE_THREADS", "2"))
        torch.set_num_threads(max(1, thr))
    except Exception:
        pass
    if _engine is None:
        from f5_tts.api import F5TTS
        _engine = F5TTS(device="cpu")
    t0 = time.time()
    _engine.infer(
        ref_file=ref_wav,
        ref_text=ref_text or None,
        gen_text=text,
        file_wave=out_wav,
        remove_silence=False,
        speed=0.85,
        seed=7,
        cfg_strength=2.0,
        nfe_step=int(os.environ.get("VOICE_NFE_STEP", "16")),
    )
    return i, out_wav, round(time.time() - t0, 1)


def _run_task_retry(task, retries=2):
    """Run one scene render, retrying on transient failure so a single bad scene
    doesn't kill the whole job (self-healing). Returns (i, out_wav, secs) or
    raises after exhausting retries."""
    last = None
    for attempt in range(retries + 1):
        try:
            return _synth_worker(task)
        except Exception as e:
            last = e
            print(f"  [voice] scene {task[0]}: attempt {attempt + 1} failed ({str(e)[:80]}) — retrying", flush=True)
            time.sleep(3 * (attempt + 1))
    raise last


def synth_manifest(manifest_path, voice_dir):
    """V10 pipeline mode: read manifest.json, render one wav per scene into voice_dir.
    Scenes render in PARALLEL (VOICE_WORKERS processes) so all CPU cores are used —
    identical quality, ~N x faster wall-clock on multi-scene jobs. Memory-bound:
    each process loads the ~2GB model, so cap VOICE_WORKERS to available RAM
    (default 2 on the 4 vCPU / 7.8GB box).

    SELF-HEALING (2026-08-30): (a) per-scene retry via _run_task_retry so one
    transient failure doesn't kill the whole job; (b) scenes whose rNN.wav already
    exists non-empty are skipped, so re-submitting the same manifest (deterministic
    job id) only renders the missing scenes."""
    import concurrent.futures as cf
    man = json.load(open(manifest_path, encoding="utf-8"))
    Path(voice_dir).mkdir(parents=True, exist_ok=True)
    workers = max(1, int(os.environ.get("VOICE_WORKERS", "2")))

    jobs = []
    for i, sc in enumerate(man.get("scenes", []), 1):
        text = " ".join((sh.get("text") or "").strip() for sh in sc.get("shots", []) if (sh.get("text") or "").strip())
        if not text:
            continue
        out = os.path.join(voice_dir, f"r{i:02d}.wav")
        if os.path.exists(out) and os.path.getsize(out) > 0:
            print(f"  [voice] scene {i}: cached", flush=True)
            continue
        jobs.append((i, text, out))

    if not jobs:
        print(f"[voice] done 0 new scenes -> {voice_dir}", flush=True)
        return []

    print(f"  [voice] {len(jobs)} scenes to synthesize across {workers} worker(s)", flush=True)
    t_start = time.time()
    tasks = [(i, txt, out, REF_WAV, REF_TEXT, OUT_DIR) for (i, txt, out) in jobs]
    results = []
    if workers <= 1:
        for t in tasks:
            results.append(_run_task_retry(t))
    else:
        # spawn-process pool so each worker has its own model (no GIL contention)
        with cf.ProcessPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_run_task_retry, t): t[0] for t in tasks}
            for fut in cf.as_completed(futs):
                i, out_wav, secs = fut.result()  # raises after per-scene retries exhausted
                print(f"  [voice] scene {i}: done in {secs}s", flush=True)
                results.append({"index": i, "wav": out_wav})
    print(f"[voice] done {len(results)} scenes in {round(time.time()-t_start)}s -> {voice_dir}", flush=True)
    return results


def worker_loop(jobs_dir, voice_dir, poll=15, max_partial=5):
    """Poll jobs_dir for manifest.json; render; move it away. Runs forever.
    Tolerates half-written job files: if a job fails to parse, retry it a few
    times (the writer may still be flushing) before marking it .failed.

    CRITICAL (2026-08-30): each job renders into its OWN subdir
    <voice_dir>/<job_stem>/ so rNN.wav filenames from one job can NEVER be
    mistaken for cached output of a later job (the old shared-dir layout
    reused stale wavs across jobs — the "War of the Bucket" sample's scenes
    1-4 got a previous test's audio)."""
    Path(jobs_dir).mkdir(parents=True, exist_ok=True)
    Path(voice_dir).mkdir(parents=True, exist_ok=True)
    print(f"[voice] worker watching {jobs_dir} (every {poll}s)", flush=True)
    attempts = {}
    while True:
        for jf in sorted(Path(jobs_dir).glob("*.json")):
            if jf.suffix == ".json":
                try:
                    job_sub = Path(voice_dir) / jf.stem
                    job_sub.mkdir(parents=True, exist_ok=True)
                    synth_manifest(str(jf), str(job_sub))
                    jf.rename(jf.with_suffix(".done"))
                    attempts.pop(jf.name, None)
                    print(f"[voice] completed {jf.name} -> {job_sub}", flush=True)
                except Exception as e:
                    attempts[jf.name] = attempts.get(jf.name, 0) + 1
                    print(f"[voice] {jf.name} attempt {attempts[jf.name]}: {str(e)[:100]}", flush=True)
                    if attempts[jf.name] >= max_partial:
                        jf.rename(jf.with_suffix(".failed"))
                        attempts.pop(jf.name, None)
        time.sleep(poll)


def main():
    ap = argparse.ArgumentParser(description="Contabo CPU voice worker (ONNX)")
    ap.add_argument("--check", action="store_true", help="verify deps + model files")
    ap.add_argument("--text", default="", help="single-shot synthesis test")
    ap.add_argument("--manifest", default="", help="V10 manifest.json -> voice dir")
    ap.add_argument("--voice-dir", default=env("VOICE_OUT_DIR", "/opt/voice/out"))
    ap.add_argument("--worker", action="store_true", help="background worker loop")
    ap.add_argument("--jobs-dir", default=env("VOICE_JOBS_DIR", "/opt/voice/jobs"))
    args = ap.parse_args()

    Path(args.voice_dir).mkdir(parents=True, exist_ok=True)
    if args.check:
        sys.exit(0 if check() else 1)
    if args.text:
        print("[voice] single-shot:", args.text)
        check()  # fail fast if deps missing
        w = synthesize(args.text)
        print("[voice] wrote", w)
        return
    if args.manifest:
        check()
        synth_manifest(args.manifest, args.voice_dir)
        return
    if args.worker:
        worker_loop(args.jobs_dir, args.voice_dir)
        return
    ap.print_help()


if __name__ == "__main__":
    main()
