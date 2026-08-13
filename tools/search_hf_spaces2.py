# Find popular, running image-generation Spaces with a simple public Gradio API.
import requests
from huggingface_hub import HfApi

api = HfApi()
terms = ["flux", "stable-diffusion", "text-to-image", "sdxl", "flux dev", "flux1"]

seen = {}
for term in terms:
    try:
        for s in api.list_spaces(search=term, limit=50, sort="likes"):
            seen.setdefault(s.id, s.likes if s.likes else 0)
    except Exception as e:
        print("search err", term, str(e)[:60])

candidates = sorted(seen.items(), key=lambda kv: kv[1], reverse=True)[:40]
print("Candidate spaces (by likes):")
for sid, likes in candidates:
    print(f"  {likes:>6}  {sid}")

def probe(space_id):
    base = f"https://{space_id.replace('/', '-')}.hf.space"
    try:
        r = requests.get(f"{base}/config", timeout=20)
        if r.status_code != 200:
            return None, f"config HTTP {r.status_code}"
        cfg = r.json()
    except Exception as e:
        return None, f"config ERR {str(e)[:70]}"
    comps = cfg.get("components") or []
    image_outputs = []
    text_inputs = []
    for c in comps:
        if not isinstance(c, dict):
            continue
        an = c.get("api_name")
        t = str(c.get("type") or "")
        if an and "image" in t.lower():
            image_outputs.append(an)
        if an and "textbox" in t.lower() and c.get("props", {}).get("multiline") is True:
            text_inputs.append(an)
    return cfg, f"title={cfg.get('title') or cfg.get('name')} img_fns={image_outputs[:5]}"

print("\n--- Probing top candidates ---")
for sid, likes in candidates[:12]:
    cfg, info = probe(sid)
    if cfg:
        print(f"[OK] {sid} ({likes} likes): {info}")
    else:
        print(f"[--] {sid} ({likes} likes): {info}")
