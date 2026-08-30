# V10 SCENE DESIGNER — the stage between script and images.
# A Google image model (Nano Banana family via the enterprise Agent Platform client)
# reads each script scene (setting / characters / action / frames) and writes the
# FINAL per-frame image prompts: one stable background + 3 camera/object variations,
# all with the consistent narrator (red top, black trousers) and period-clothed
# characters. Also splits each scene's narration into 3 chunks (one per frame).
#
# Input : runDir/manifest.json  (script gen output: scenes[].narration/setting/characters/action/frames)
# Output: runDir/manifest.json  (pipeline format:   scenes[].shots[].text/.img, 3 shots per scene)
#         runDir/design.json    (raw designer output for debugging)
#
# CLI: python tools/_v10_scene_designer.py <runDir>
import os, sys, json, re, time, urllib.request, concurrent.futures
from google import genai
from google.genai import types

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(name):
    for line in open(os.path.join(BASE, '.env'), encoding='utf-8'):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return ''

# The SCENE DESIGNER is a PROMPT-WRITING (text) task — use TEXT models via the same
# REST path the script generator uses (image models reject TEXT-only requests with 400).
# Key waterfall: the proven GEMINI_KEYS list (works on the VPS) first, falling back to
# the single paid key. Same pattern as v10ScriptGen.js.
def _gemini_keys():
    keys = [k.strip() for k in env('GEMINI_KEYS').split(',') if k.strip()]
    paid = env('GEMINI_PAID_API_KEY') or env('Agent_Platform_key')
    if keys:
        return keys
    return [paid] if paid else []

KEYS = _gemini_keys()
DESIGNER_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.0-flash"]

NARRATOR = ("the NARRATOR stickman host — a GIANT (drawn MUCH larger than every story character, "
            "looming over the scenes or head-and-shoulders above the story world) with a large spherical "
            "white head, two dot eyes, thin curved eyebrows, a simple black line mouth and a dark ONE-EYED "
            "monocle (a single dark round lens over ONE eye, thin dark rim, short chain), wearing a SOLID "
            "BLACK suit jacket and dark trousers — who watches and gestures from above but never joins the story")

# 6-TIER PROMPT ENGINE (research): [Art Style DNA] + [Character DNA] + [Action Delta]
# + [Environment Anchor] + [Lighting/Atmosphere] + [Rendering Params].
# ART STYLE DNA — two locked constants (LIGHT default, DARK for the weekly dark rotation).
STYLE_LIGHT = ("V10 colorful storybook whiteboard art style: warm, gentle, family-friendly palette. Light warm "
               "background with pure black ink line art and hand-drawn cross-hatch textures, clean high-contrast "
               "illustration. The SCENE is alive with soft COLOUR: colored background elements, colored furniture, "
               "colored props, plants and architecture (soft greens, warm woods, muted ambers, gentle blues) that "
               "bring the scene to life. The NARRATOR is a GIANT — drawn MUCH larger than the story characters, "
               "towering over the scene — and wears a SOLID BLACK suit jacket and dark trousers with a dark "
               "one-eyed monocle over one eye; story characters wear ONE period garment with a consistent "
               "colour per character and are all the SAME SIZE as each other (but small beside the narrator). "
               "CHARACTERS ARE NOT RACIALIZED: heads/faces are ALWAYS plain white spheres, bodies are ALWAYS "
               "black-ink cross-hatch — NO skin color, NO flesh tones, NO coloured faces or bodies anywhere; "
               "the ONLY coloured element is clothing. NO text, NO letters, NO numbers, NO symbols, NO gibberish "
               "anywhere.")
STYLE_DARK = ("V10 noir graphic-novel art style: dark low-key background, deep ink hatching, dynamic "
              "chiaroscuro lighting, moody atmospheric volumetric light, subdued desaturated palette with "
              "warm amber and crimson rim lighting on the characters. NO text, NO letters, NO numbers, "
              "NO symbols, NO gibberish.")
STYLE = STYLE_LIGHT
MICRO_FRAMES = int(os.environ.get("V10_FRAMES_PER_SCENE", "6"))  # micro-frames per scene (4-6)


def split_narration(text, n):
    """Split narration into n word-balanced chunks (one per micro-frame). NEVER duplicates
    content (a duplicated chunk repeats in the spoken audio AND misaligns the frames).
    Pure word-split — audio is rejoined into ONE phrase per scene, so mid-sentence cuts
    are fine. Returns exactly n chunks (later ones empty only if fewer words than n)."""
    clean = re.sub(r'\s+', ' ', text or '').strip()
    if not clean:
        return [""] * n
    words = clean.split()
    if n <= 1:
        return [clean] + [""] * (n - 1)
    k = max(1, (len(words) + n - 1) // n)  # ceil so all n chunks carry words when possible
    chunks, i = [], 0
    for _ in range(n):
        if i >= len(words):
            chunks.append("")
            continue
        chunks.append(" ".join(words[i:i + k]))
        i += k
    return chunks


def call_gemini(prompt):
    """Text-model REST call (same proven path as v10ScriptGen). Returns parsed JSON.
    Iterates keys x models with a 60s timeout each so a dead key/model never hangs."""
    last = "no keys"
    for key in KEYS:
        for model in DESIGNER_MODELS:
            try:
                url = (f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
                       f":generateContent?key={key}")
                body = json.dumps({
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.4, "maxOutputTokens": 6000,
                                         "responseMimeType": "application/json"},
                }).encode("utf-8")
                req = urllib.request.Request(url, data=body,
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    j = json.loads(resp.read().decode("utf-8"))
                txt = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
                m = re.search(r'\{[\s\S]*\}', txt)
                if m:
                    return json.loads(m.group(0))
                last = "no JSON in response"
            except Exception as e:
                last = str(e)
                print(f"   [designer] {model}: {last[:100]}", flush=True)
                time.sleep(2)
    raise RuntimeError("scene designer: all keys/models failed: " + last[:200])


def design_scene(sc, idx, chunks):
    """Design one micro-frame PER narration chunk, each frame DEPICTING its chunk's content
    (object/action/expression the words describe) so the picture matches the spoken text.
    Same locked background + same characters across all frames (framing-consistent)."""
    n_frames = max(1, len(chunks))
    chunk_lines = "\n".join(
        f'  chunk {j + 1}: "{chunks[j]}"' for j in range(n_frames) if (chunks[j] or "").strip())
    prompt = (f"You are the V10 SCENE DESIGNER. Turn ONE script scene into {n_frames} MICRO-FRAME image "
              f"prompts. Each micro-frame must VISUALLY DEPICT what its narration chunk SAYS (the object, "
              f"action, expression or prop the words describe) — the picture must match the words spoken "
              f"at that moment. This is CONCEPTUAL ILLUSTRATION: the FRAME is FIXED (same camera, same angle, "
              f"same framing, same composition, center subject stays centered) across ALL frames, and ONLY the "
              f"objects/characters inside the frame change — they may MOVE, APPEAR, or DISAPPEAR as the narration "
              f"describes (e.g. a ball is removed, a second person steps away, a flag appears). Never change the "
              f"camera or the composition.\n\n{STYLE}\n\nNARRATOR: {NARRATOR}.\n\n"
              f"SCENE {idx}:\n"
              f"- setting (background, must be STABLE/identical across ALL {n_frames} frames): {sc.get('setting') or '(default: warm whiteboard studio)'}\n"
              f"- characters (keep outfits consistent + all same size; may be added/removed per chunk): {sc.get('characters') or 'narrator only'}\n"
              f"- story beat / action: {sc.get('action') or 'the narrator narrates'}\n"
              f"NARRATION CHUNKS (frame K must depict chunk K):\n{chunk_lines}\n\n"
              f"Write STRICT JSON ONLY:\n"
              f"{{\"bg\": \"<ONE complete background prompt — the setting + its objects, reusable in every frame>\", "
              f"\"frames\": [\"<frame1: bg + narrator + characters, depicting chunk 1>\", "
              f"\"<frame2: EXACT same bg + SAME camera/framing, depicting chunk 2 (objects/characters may differ)>\", "
              f"... {n_frames} frames total ...]}}\n\n"
              f"Rules: every frame prompt must START with the same background sentence (verbatim). The camera "
              f"NEVER moves and the framing NEVER changes between frames (same angle, same distances, center "
              f"subject stays centered). Each frame depicts its narration chunk's content — objects/characters "
              f"may be added, removed, or repositioned WITHIN the fixed frame as the words describe. Always "
              f"include the narrator (red top, black trousers) unless the chunk removes him. All characters "
              f"same size. NO text anywhere.")
    data = call_gemini(prompt)
    frames = [(f or "").strip() for f in (data.get("frames") or [])]
    frames = frames[:n_frames]
    while len(frames) < n_frames:
        frames.append(frames[-1] if frames else "the narrator narrates")
    return {
        "bg": (data.get("bg") or "").strip(),
        "frames": frames,
    }


def _design_one(n, sc):
    try:
        target = MICRO_FRAMES
        chunks = split_narration(sc.get("narration"), target)
        n_frames = len([c for c in chunks if c and c.strip()]) or 1
        chunks = chunks[:n_frames]
        d = design_scene(sc, n, chunks)
        return n, sc, d, chunks, None
    except Exception as e:
        return n, sc, None, None, str(e)


def run(run_dir):
    manifest_path = os.path.join(run_dir, "manifest.json")
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    scenes = manifest.get("scenes") or []
    print(f"[designer] designing {len(scenes)} scenes -> {MICRO_FRAMES} micro-frames each (parallel)", flush=True)

    jobs = [(i + 1, sc) for i, sc in enumerate(scenes) if (sc.get("narration") or "").strip()]
    results = {}
    workers = min(6, max(1, len(jobs) or 1))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_design_one, n, sc) for n, sc in jobs]
        for f in concurrent.futures.as_completed(futs):
            n, sc, d, chunks, err = f.result()
            results[n] = (d, chunks, err)
            if err:
                print(f"  scene {n}: FAILED {err[:120]}", flush=True)
            else:
                print(f"[designer] scene {n}: {(sc.get('label') or '')[:30]} done ({len(chunks)} chunks)", flush=True)

    out_scenes, design_log = [], []
    for n, sc in jobs:
        d, chunks, err = results.get(n, (None, None, "no result"))
        if not d or not chunks:
            continue
        shots = []
        for j, img in enumerate(d.get("frames") or []):
            if j >= len(chunks):
                break
            shots.append({"text": chunks[j] or "", "img": img})
        if not shots:
            continue
        out_scenes.append({"n": n, "label": sc.get("label") or f"Scene {n}", "shots": shots})
        design_log.append({"n": n, "label": sc.get("label"), "bg": d.get("bg"), "frames": d.get("frames"), "chunks": chunks})
        print(f"  -> {len(shots)} micro-frames designed", flush=True)

    out_manifest = {"style": manifest.get("style"), "scenes": out_scenes}
    json.dump(out_manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(design_log, open(os.path.join(run_dir, "design.json"), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    total_shots = sum(len(s["shots"]) for s in out_scenes)
    print(f"[designer] wrote {len(out_scenes)} designed scenes, {total_shots} shots -> {manifest_path}", flush=True)
    return {"scenes": len(out_scenes), "shots": total_shots}


if __name__ == '__main__':
    rd = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "temp_media", "v10_run", "test")
    print("[designer] done:", run(rd))
