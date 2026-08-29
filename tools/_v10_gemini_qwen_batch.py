# V10 production image batch — GEMINI FIRST (cheap lite model, $0.0336/img) via the
# google-genai client in ENTERPRISE (Agent Platform) mode, with MULTI-TURN character
# consistency, falling back to Qwen-Image-Edit-2511 when Gemini credits/quota are
# exhausted. Resume-safe.
#
# Key order (user directive 2026-08-28): Agent_Platform_key ($300 free credit) first,
# then GEMINI_PAID_API_KEY ($10 top-up). Use the CHEAP model only (flash-lite-image).
#
# Usage:
#   python tools/_v10_gemini_qwen_batch.py --manifest <manifest.json> --images <dir> [--limit N] [--start N] [--seed S] [--force]
import os, sys, json, time, shutil, base64, argparse, threading
import concurrent.futures
from google import genai
from google.genai import types
from gradio_client import Client, handle_file

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(name):
    for line in open(os.path.join(BASE, '.env'), encoding='utf-8'):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return ''

REF = r"C:\Users\hp\Downloads\Stick_Figure_Animation_Images___202608260003.jpeg"

# CHEAP Gemini image model only (user: "do not use the expensive model")
GEMINI_MODEL = "gemini-3.1-flash-lite-image"
# Agent Platform keys must go through genai.Client(enterprise=True, api_key=KEY)
# (plain ?key= REST is blocked; enterprise mode routes to the key's real project).

# Qwen partner — comma-separated list lets us parallelize across multiple spaces
# (e.g. V10_QWEN_SPACES="Qwen/Qwen-Image-Edit-2511,LPX55/Qwen-Image-Edit-2511-Turbo-Lightning")
QWEN_SPACES = [s.strip() for s in (env('V10_QWEN_SPACES') or 'Qwen/Qwen-Image-Edit-2511').split(',') if s.strip()]
QWEN_STEPS = int(env('V10_QWEN_STEPS') or '40')
QWEN_GUIDANCE = float(env('V10_QWEN_GUIDANCE') or '4.0')
QWEN_W, QWEN_H = 1024, 576
_qwen_clients = {}

def _qwen_client(space):
    if space not in _qwen_clients:
        _qwen_clients[space] = Client(space, headers={'Authorization': f'Bearer {env("HF_ACCESS_TOKEN")}'}, verbose=False)
    return _qwen_clients[space]

CHAR = ("Reproduce the EXACT SAME character style from the reference image: large spherical white head, "
        "two small dot eyes, thin curved eyebrows, simple black line mouth, body filled with a dense "
        "hand-drawn diagonal ink cross-hatch scribble texture (NOT solid black; tiny white paper gaps "
        "between the hatch lines), simple rounded mitten hands with no fingers, flat black feet. "
        "Every character's face ALWAYS clearly shows two small black dot EYES, thin curved EYEBROWS and a "
        "small simple black line MOUTH — the eyes and mouth must ALWAYS be present and clearly visible on "
        "every character, never blank, never omitted. Heads and faces are ALWAYS the plain WHITE sphere — "
        "NO skin color, NO flesh tones, NO coloured faces, NO blush, NO tan. Bodies, hands and arms are "
        "ALWAYS the black-ink cross-hatch texture — NO coloured bodies, NO skin tones on hands. The ONLY "
        "coloured element on a character is their clothing (the narrator's black suit / a story character's "
        "single period garment). "
        "Cross-hatch ONLY on the body. THE NARRATOR IS A GIANT — drawn MUCH larger than every story "
        "character, towering over the scenes — and wears a SOLID BLACK suit jacket and dark trousers, "
        "with a dark ONE-EYED monocle (a single dark round lens over ONE eye, thin dark rim, short chain) "
        "always on his face. STORY CHARACTERS use the same stickman design but are SMALL beside the giant "
        "narrator; they wear ONE period-coloured garment (e.g. a blue tunic, a yellow gown, a green robe) "
        "— each character keeps their single garment colour CONSISTENT in every scene. ALL story "
        "characters are the SAME SIZE as each other. "
        "The SCENE and BACKGROUND are a warm, gentle storybook illustration full of soft COLOUR: coloured "
        "background elements, coloured furniture, coloured props, coloured plants and architecture — a "
        "cosy palette of soft greens, warm woods, muted ambers and gentle blues that brings the scene to "
        "life. Soft shading is allowed; NO harsh photorealism, NO neon, NO heavy gradients. All books and "
        "objects BLANK with NO text, NO letters, NO numbers, NO symbols, NO gibberish anywhere. "
        "High-contrast storybook illustration.")

def make_client(key):
    """Agent Platform key -> enterprise mode; fall back to plain api_key client."""
    try:
        return genai.Client(enterprise=True, api_key=key)
    except Exception:
        return genai.Client(api_key=key)

# cache clients per key (enterprise client creation is cheap but reuse is cleaner)
_CLIENTS = {}
def _client_for(key):
    if key not in _CLIENTS:
        _CLIENTS[key] = make_client(key)
    return _CLIENTS[key]

def gemini_gen(contents, key):
    """One Gemini image call (cheap model) via google-genai. contents = list of dicts."""
    client = _client_for(key)
    parts = []
    for c in contents:
        if "text" in c:
            parts.append(types.Part(text=c["text"]))
        elif "inlineData" in c:
            parts.append(types.Part(inline_data=types.Blob(
                mime_type=c["inlineData"]["mimeType"],
                data=c["inlineData"]["data"])))
    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=types.Content(role="user", parts=parts),
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(aspect_ratio="16:9"),
        ),
    )
    for part in resp.candidates[0].content.parts:
        if part.inline_data and part.inline_data.data:
            return bytes(part.inline_data.data)
    raise RuntimeError("no image part in Gemini response")

def gemini_try(scene_prompt, key, scene_anchor=None):
    """Reference + optional scene anchor (frame 1 of the SAME scene) + CHAR prompt.
    The anchor keeps the background/framing locked; the prompt carries the micro-frame delta."""
    contents = [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(open(REF, 'rb').read()).decode()}}]
    if scene_anchor:
        contents.append({"inlineData": {"mimeType": "image/png", "data": base64.b64encode(scene_anchor).decode()}})
        contents.append({"text": f"{CHAR} This is the SAME scene as the anchor image above. "
                                  f"Keep the background, camera angle, framing, character positions, "
                                  f"colors and outfits IDENTICAL; only apply this ONE small "
                                  f"pose/expression/prop change (the micro-frame delta): {scene_prompt}"})
    else:
        contents.append({"text": f"{CHAR} New scene (base frame): {scene_prompt}"})
    return gemini_gen(contents, key)

def qwen_unwrap(res):
    img = res
    for _ in range(4):
        if isinstance(img, (list, tuple)) and img:
            img = img[0]
    if isinstance(img, dict):
        img = img.get('image') or img.get('video') or img.get('path') or img
    if hasattr(img, 'path'):
        img = img.path
    return img

def _qwen_predict(c, gallery, scene_prompt, seed, turbo):
    if turbo:
        return c.predict(
            gallery, scene_prompt, seed, False,
            QWEN_GUIDANCE, int(env('V10_QWEN_TURBO_STEPS') or '4'),
            QWEN_W, QWEN_H, False, 1,
            api_name="/infer")
    return c.predict(
        gallery, scene_prompt, seed, False,
        QWEN_GUIDANCE, QWEN_STEPS, QWEN_W, QWEN_H, False,
        api_name="/infer")


def qwen_gen(scene_prompt, seed, out, spaces=None):
    """Qwen-Image-Edit via gradio /infer. Tries each configured space in turn.
    Turbo/Lightning spaces use a slightly different /infer signature (4 steps + extra arg).
    Each call is wrapped in a timeout so a hung ZeroGPU queue can NEVER wedge the batch."""
    spaces = spaces or QWEN_SPACES
    last = None
    for space in spaces:
        try:
            c = _qwen_client(space)
            gallery = [{"image": handle_file(REF), "caption": None}]
            low = space.lower()
            turbo = any(k in low for k in ('turbo', 'lightning', 'lora', 'fast'))
            ex = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            try:
                fut = ex.submit(_qwen_predict, c, gallery, scene_prompt, seed, turbo)
                res = fut.result(timeout=240)   # 4 min cap
            finally:
                ex.shutdown(wait=False)
            img = qwen_unwrap(res)
            if isinstance(img, str) and img.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                shutil.copy(img, out)
                return True
        except Exception as e:
            last = e
    if last:
        raise last
    return False

# ---- KEY MANAGEMENT: auto-discover usable image keys (probe once, cache 6h) ----
def _candidate_keys():
    keys, seen = [], set()
    for name in ['Agent_Platform_key', 'GEMINI_PAID_API_KEY']:
        v = env(name)
        if v and v not in seen:
            seen.add(v); keys.append((name, v))
    for i, k in enumerate((env('GEMINI_KEYS') or '').split(',')):
        k = k.strip()
        if k and k not in seen:
            seen.add(k); keys.append((f'GEMINI_KEYS[{i}]', k))
    return keys


KEY_CACHE = os.path.join(BASE, 'temp_media', 'v10_img_keys.json')


def _probe_one(name_key):
    """Probe a key with a tiny image call. Retries on TRANSIENT 429 so a momentary
    rate-limit doesn't poison the usable-key cache for 6h. Hard errors (prepayment/
    quota disabled) fail fast."""
    name, key = name_key
    for attempt in range(3):
        try:
            client = _client_for(key)
            ref = base64.b64encode(open(REF, 'rb').read()).decode()
            resp = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=types.Content(role='user', parts=[
                    types.Part(inline_data=types.Blob(mime_type='image/jpeg', data=ref)),
                    types.Part(text='tiny probe: the same stickman character alone, plain background')]),
                config=types.GenerateContentConfig(response_modalities=['TEXT', 'IMAGE']),
            )
            for part in resp.candidates[0].content.parts:
                if part.inline_data and part.inline_data.data:
                    return name
        except Exception as e:
            em = str(e)
            if '429' in em or 'RESOURCE_EXHAUSTED' in em:
                time.sleep(3 * (attempt + 1))   # transient rate limit — retry before giving up
                continue
            break  # hard error (billing/quota disabled) — don't retry
    return None


def _load_usable_keys(force=False):
    cand = _candidate_keys()
    now = time.time()
    if os.path.exists(KEY_CACHE) and not force:
        try:
            c = json.load(open(KEY_CACHE, encoding='utf-8'))
            if now - c.get('at', 0) < 6 * 3600:
                cmap = dict(cand)
                return [(n, cmap[n]) for n in c.get('usable', []) if n in cmap]
        except Exception:
            pass
    usable = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(cand))) as ex:
        for name in ex.map(_probe_one, cand):
            if name:
                usable.append(name)
    json.dump({'at': now, 'usable': usable}, open(KEY_CACHE, 'w', encoding='utf-8'))
    cmap = dict(cand)
    return [(n, cmap[n]) for n in usable]


def _is_hard(em):
    low = em.lower()
    return ('prepayment' in low or 'billing' in low or 'quota exceeded' in low
            or 'access not configured' in low or 'permission denied' in low
            or 'does not have' in low or 'depleted' in low)


def _gen_one(task, usable, images_dir, seed, lock, counters, dead, dead_lock, qwen_spaces, qwen_sem, qwen_cap, qwen_dormant=False):
    """Generate ONE frame. Parallel-safe. j>1 frames read their scene's frame-1 anchor
    from disk (background consistency) and send a micro-frame delta prompt.

    STRATEGY (user directive): Gemini is the PRIMARY engine (3 image keys, smart
    rotation, persistent retries). Qwen stays DORMANT (saves ZeroGPU for VOICE) and is
    only a FAIL-SAFE: if a frame can't be produced by any Gemini key, it falls to Qwen.
    qwen_dormant=True disables even that (pure-Gemini mode). When the $300 Gemini
    credit ends, all keys hard-fail -> every frame flows to Qwen automatically."""
    n, j, prompt = task
    out = os.path.join(images_dir, f'rep_{n:02d}_{j:02d}.png')
    scene_anchor = None
    apath = os.path.join(images_dir, f'rep_{n:02d}_01.png')
    if j > 1 and os.path.exists(apath) and os.path.getsize(apath) > 0:
        scene_anchor = open(apath, 'rb').read()
    with lock:
        counters['_ki'] = (counters.get('_ki', 0) + 1) % max(1, len(usable))
        start = counters['_ki']
    last_err = None
    # GEMINI primary: try each key up to 3 attempts (smart rotation, no wasted calls);
    # only fall to Qwen after ALL keys fail for this frame.
    for off in range(len(usable)):
        idx = (start + off) % len(usable)
        kname, key = usable[idx]
        with dead_lock:
            if kname in dead:
                continue
        for attempt in range(3):
            try:
                buf = gemini_try(prompt, key, scene_anchor=scene_anchor)
                open(out, 'wb').write(buf)
                with lock:
                    counters['ok'] += 1
                print(f'[gq] scene {n} f{j} OK ({kname}, {(len(buf)/1024):.0f}KB)', flush=True)
                return 'ok'
            except Exception as e:
                em = str(e)
                last_err = em
                if _is_hard(em):
                    with dead_lock:
                        dead.add(kname)
                    print(f'[gq] scene {n} f{j}: key {kname} HARD-fail disabled ({em[:70]})', flush=True)
                    break
                print(f'[gq] scene {n} f{j}: {kname} a{attempt+1} ({em[:55]})', flush=True)
                time.sleep(3 * (attempt + 1))
    # QWEN FAIL-SAFE (dormant by default — ZeroGPU is reserved for VOICE). Only used
    # when Gemini could not produce this frame. Rotates space start so fallback
    # spreads across the clone spaces.
    if qwen_spaces and not qwen_dormant:
        capped = False
        if qwen_cap:
            with lock:
                if counters['qwen'] >= qwen_cap:
                    capped = True
        if capped:
            print(f'[gq] scene {n} f{j}: qwen cap reached, FAILED', flush=True)
        else:
            with lock:
                counters['_qsi'] = (counters.get('_qsi', 0) + 1) % len(qwen_spaces)
                qstart = counters['_qsi']
            q_rot = qwen_spaces[qstart:] + qwen_spaces[:qstart]
            with qwen_sem:
                for attempt in range(3):
                    try:
                        # prepend CHAR so Qwen gets the same character lock Gemini gets
                        if qwen_gen(CHAR + ' ' + prompt, seed + n * 10 + j + attempt, out, q_rot):
                            with lock:
                                counters['qwen'] += 1
                            print(f'[gq] scene {n} f{j} QWEN OK', flush=True)
                            return 'qwen'
                    except Exception as e:
                        print(f'[gq] scene {n} f{j}: qwen a{attempt+1} ({str(e)[:70]})', flush=True)
                        time.sleep(4)
    with lock:
        counters['fail'] += 1
    print(f'[gq] scene {n} f{j} FAILED ({last_err[:80] if last_err else "?"})', flush=True)
    return 'fail'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--images', required=True)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--seed', type=int, default=7001)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--workers', type=int, default=0)
    ap.add_argument('--qwen-cap', type=int, default=0, help='max Qwen images per run (0 = unlimited)')
    ap.add_argument('--qwen-workers', type=int, default=0, help='concurrent Qwen calls (default = number of qwen spaces)')
    ap.add_argument('--qwen-dormant', action='store_true', help='never use Qwen (ZeroGPU reserved for voice)')
    args = ap.parse_args()
    if args.qwen_workers <= 0:
        args.qwen_workers = min(6, max(1, len(QWEN_SPACES)))

    os.makedirs(args.images, exist_ok=True)
    manifest = json.load(open(args.manifest, encoding='utf-8'))
    scenes = manifest['scenes']
    if args.limit:
        scenes = scenes[:args.limit]
    if args.start:
        scenes = scenes[args.start:]

    usable = _load_usable_keys()
    if not usable:
        usable = _candidate_keys()
    print(f'[gq] usable image keys ({len(usable)}): {[n for n, _ in usable]}', flush=True)
    workers = args.workers or min(8, max(2, len(usable) * 3))
    print(f'[gq] parallel workers: {workers} | qwen spaces: {QWEN_SPACES} | qwen workers: {args.qwen_workers}', flush=True)

    # flatten scenes x shots -> (n, j, prompt)
    tasks = []
    for i, sc in enumerate(scenes):
        n = i + 1 + args.start
        shots = sc.get('shots') or [{'text': sc.get('narration', ''), 'img': sc.get('action', '')}]
        for j, sh in enumerate(shots):
            p = (sh.get('img') or '').strip()
            if p:
                tasks.append((n, j + 1, p))

    # resume-safe: skip already-generated frames (unless --force)
    pending = []
    for t in tasks:
        n, j, _ = t
        out = os.path.join(args.images, f'rep_{n:02d}_{j:02d}.png')
        if os.path.exists(out) and os.path.getsize(out) > 0 and not args.force:
            continue
        pending.append(t)
    print(f'[gq] {len(tasks)} frames total, {len(pending)} to generate', flush=True)

    # TWO-PHASE PARALLEL: frame 1 of every scene (the anchors) first, then the
    # micro-frame deltas (each reads its scene's frame-1 anchor). All keys work in parallel.
    phaseA = [t for t in pending if t[1] == 1]
    phaseB = [t for t in pending if t[1] > 1]

    counters = {'ok': 0, 'qwen': 0, 'fail': 0}
    lock = threading.Lock()
    dead = set()
    dead_lock = threading.Lock()
    qwen_spaces = QWEN_SPACES
    qwen_workers = args.qwen_workers if args.qwen_workers and args.qwen_workers > 0 else min(4, max(1, len(qwen_spaces)))
    qwen_sem = threading.Semaphore(max(1, qwen_workers))

    def run_phase(phase):
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(_gen_one, t, usable, args.images, args.seed, lock, counters,
                              dead, dead_lock, qwen_spaces, qwen_sem, args.qwen_cap,
                              args.qwen_dormant) for t in phase]
            for f in concurrent.futures.as_completed(futs):
                f.result()

    if phaseA:
        print(f'[gq] PHASE A: {len(phaseA)} scene anchors (parallel)', flush=True)
        run_phase(phaseA)
    if phaseB:
        print(f'[gq] PHASE B: {len(phaseB)} micro-frame deltas (parallel)', flush=True)
        run_phase(phaseB)

    print(f'[gq] done: gemini_ok={counters["ok"]} qwen_ok={counters["qwen"]} fail={counters["fail"]} '
          f'skipped={len(tasks) - len(pending)}')
    print(f'[gq] images dir: {args.images} ({len([f for f in os.listdir(args.images) if f.endswith(".png")])} png files)')

if __name__ == '__main__':
    main()
