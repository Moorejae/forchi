#!/usr/bin/env python3
"""
image_generator.py — High-speed image generation via Google Vertex AI (Gemini image).

Verified working path (2026-08-29): the ONLY image model reachable in project
flash-realm-507013-t3 is `gemini-2.5-flash-image` via the Vertex `generateContent`
REST endpoint. (Imagen models 404 here; the vertexai=True SDK path hangs ~3min —
so we call REST directly with the service-account OAuth token.)

KEY OPTIMIZATIONS
-----------------
* ThreadPoolExecutor concurrency  -> many requests in flight at once (10+ images/min).
* region rotation                 -> us-central1 / europe-west1 / us-east1 on errors.
* exponential backoff + jitter    -> seamless transient-error recovery.
* resume-safe                     -> skips existing non-empty .png outputs.

CREDENTIALS (in .env)
---------------------
    GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\service-account-key.json"
    GCP_project_id="<gcp-project-id>"   (or GOOGLE_VERTEX_PROJECT)

USAGE
-----
# Simple: prompt(s) -> images
python image_generator.py --prompts "the giant black-suit narrator in a warm study" --out out_dir

# Prompt list file (one prompt per line)
python image_generator.py --prompts-file prompts.txt --out out_dir --concurrency 4

# V10 pipeline mode: read a manifest.json (scenes[].shots[].img) and render the
# V10-style images dir (rep_XX_YY.png) so it can replace the HF images stage.
python image_generator.py --manifest temp_media/v10_run/<run>/manifest.json \
    --images temp_media/v10_run/<run>/images --concurrency 6
"""
import os, sys, json, base64, random, time, argparse, urllib.request, urllib.error
import concurrent.futures
from pathlib import Path


# ---- load .env (so GOOGLE_APPLICATION_CREDENTIALS / project id are honored) ----
def _load_env(path=".env"):
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('\"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
    except FileNotFoundError:
        pass


_load_env()

PRIMARY_MODEL = "gemini-2.5-flash-image"   # the ONLY image model reachable in flash-realm-507013-t3
LOCATIONS = ["us-central1", "europe-west1", "us-east1"]  # verified working regions

# V10 channel style (colorful storybook + neutral white-head/ink-body characters).
# Override via V10_VERTEX_STYLE if you want a different look.
DEFAULT_STYLE = os.environ.get(
    "V10_VERTEX_STYLE",
    "V10 colorful storybook whiteboard illustration, warm gentle family-friendly palette, pure black ink "
    "line art with hand-drawn cross-hatch textures on a light warm background, soft greens warm woods muted "
    "ambers gentle blues. THE NARRATOR IS A GIANT — drawn MUCH larger than every story character, towering "
    "over the scene — a stickman with a plain white spherical head, two small dot eyes, a small black line "
    "mouth and a dark ONE-EYED monocle (single dark round lens over ONE eye, thin dark rim, short chain), "
    "wearing a SOLID BLACK suit jacket and dark trousers. Heads/faces ALWAYS plain white, bodies always "
    "black-ink cross-hatch, NO skin color or flesh tones anywhere; the only coloured element is clothing. "
    "NO text, NO letters, NO numbers, NO symbols, NO gibberish anywhere. High-contrast cinematic 16:9 "
    "composition.",
)


def env(name, default=""):
    return os.environ.get(name, default)


# ---- auth: service-account OAuth token (cached) ----
_token = None


def _access_token():
    global _token
    if _token:
        return _token
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds_path = env("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds_path or not os.path.exists(creds_path):
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS not set/valid in .env")
    creds = service_account.Credentials.from_service_account_file(
        creds_path, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(Request())
    _token = creds.token
    return _token


def _project():
    return env("GOOGLE_VERTEX_PROJECT") or env("GCP_project_id") or env("GCP_PROJECT_ID")


# ---- one REST generateContent call -> image bytes ----
def _gen_one(prompt, loc, timeout=120):
    url = (f"https://{loc}-aiplatform.googleapis.com/v1/projects/{_project()}"
           f"/locations/{loc}/publishers/google/models/{PRIMARY_MODEL}:generateContent")
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode())
    cands = body.get("candidates", [])
    if not cands:
        raise RuntimeError(f"{loc}: no candidates — {str(body)[:120]}")
    imgs = [base64.b64decode(p.get("inlineData", {}).get("data", "")) for p in
            cands[0].get("content", {}).get("parts", []) if "inlineData" in p]
    imgs = [b for b in imgs if b]
    if not imgs:
        raise RuntimeError(f"{loc}: no image in response")
    return imgs[0]


def _gen_with_retry(prompt, max_retries=6, base=1.6, jitter=1.2):
    """Synchronous retry across locations; exp backoff + jitter on transient errors."""
    last_err = None
    for attempt in range(max_retries):
        loc = LOCATIONS[attempt % len(LOCATIONS)]
        try:
            return _gen_one(prompt, loc)
        except urllib.error.HTTPError as e:
            code = e.code
            msg = ""
            try:
                msg = json.loads(e.read().decode("utf-8", "replace")).get("error", {}).get("message", "")[:100]
            except Exception:
                pass
            retryable = code in (429, 500, 502, 503, 504) or "quota" in msg.lower()
            last_err = f"HTTP {code} {msg}"
            if not retryable:
                # non-transient (400/403/404) — rotate to next region and continue
                pass
        except Exception as e:
            last_err = f"{type(e).__name__}: {str(e)[:80]}"
        wait = base * (2 ** attempt) + random.uniform(0, jitter)
        print(f"  [img] attempt {attempt + 1} {loc}: {last_err} — retry in {wait:.1f}s", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"{PRIMARY_MODEL}: gave up after {max_retries} retries ({last_err})")


def run(jobs, out_dir, concurrency, style):
    """jobs: list of (name, prompt). Writes images under out_dir, resume-safe."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    done = 0

    def worker(name, prompt):
        nonlocal done
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[:80]
        out_path = out_dir / f"{safe}.png"
        if out_path.exists() and out_path.stat().st_size > 0:
            print(f"  [img] {name}: cached", flush=True)
            return
        try:
            data = _gen_with_retry(f"{style} {prompt}")
            Path(out_path).write_bytes(data)
            done += 1
            print(f"  [img] {name}: {out_path.name} ({round(time.time()-t0)}s)", flush=True)
        except Exception as e:
            print(f"  [img] {name}: FAILED — {str(e)[:90]}", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        futures = [ex.submit(worker, n, p) for n, p in jobs]
        for f in concurrent.futures.as_completed(futures):
            pass  # exceptions are handled inside worker
    print(f"[img] done {done}/{len(jobs)} images in {round(time.time()-t0)}s -> {out_dir}", flush=True)


def load_jobs(args):
    jobs = []
    if args.manifest:
        man = json.load(open(args.manifest, encoding="utf-8"))
        for i, sc in enumerate(man.get("scenes", [])):
            for j, sh in enumerate(sc.get("shots", [])):
                p = (sh.get("img") or "").strip()
                if p:
                    jobs.append((f"rep_{i+1:02d}_{j+1:02d}", p))
        return jobs, Path(args.images)
    if args.prompts_file:
        lines = [l.strip() for l in open(args.prompts_file, encoding="utf-8") if l.strip()]
        jobs = [(f"img_{k:04d}", l) for k, l in enumerate(lines, 1)]
        return jobs, Path(args.out)
    for k, p in enumerate(args.prompts, 1):
        jobs.append((f"img_{k:04d}", p))
    return jobs, Path(args.out)


def main():
    ap = argparse.ArgumentParser(description="Vertex AI Gemini image generator (gemini-2.5-flash-image)")
    ap.add_argument("--prompts", nargs="*", default=[], help="inline prompts")
    ap.add_argument("--prompts-file", default="", help="file with one prompt per line")
    ap.add_argument("--manifest", default="", help="V10 manifest.json (pipeline mode)")
    ap.add_argument("--images", default="", help="output dir for --manifest mode")
    ap.add_argument("--out", default="out_images", help="output dir")
    ap.add_argument("--concurrency", type=int, default=5, help="parallel requests")
    ap.add_argument("--style", default=DEFAULT_STYLE, help="style prefix (default = V10)")
    args = ap.parse_args()

    if not (args.prompts or args.prompts_file or args.manifest):
        ap.error("provide --prompts, --prompts-file, or --manifest")

    jobs, out_dir = load_jobs(args)
    print(f"[img] {len(jobs)} jobs -> {out_dir} (model={PRIMARY_MODEL}, concurrency={args.concurrency})", flush=True)
    run(jobs, out_dir, args.concurrency, args.style)


if __name__ == "__main__":
    main()
