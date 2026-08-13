# Test the upgraded image Space with the real FB (anime) and LI (cyberpunk) style prompts.
import json, time, requests

BASE = "https://slymun-forchi-img.hf.space"

PROMPTS = {
    "fb": "a lone figure walking through rain at night, high-end anime art, lo-fi digital illustration, manga-style painting, soft atmospheric detail, vibrant colors",
    "li": "futuristic robotic mecha in a neon cyberpunk city, high-end photorealistic tech image, cyberpunk mecha digital art, futuristic robotics aesthetic, cinematic lighting, ultra detailed",
}

def gen(prompt):
    r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": [prompt]}, timeout=60)
    if r.status_code != 200:
        print("POST", r.status_code, r.text[:200]); return None
    event_id = r.json().get("event_id")
    url = None
    for i in range(180):
        try:
            s = requests.get(f"{BASE}/gradio_api/call/generate/{event_id}", stream=True, timeout=60)
            for raw in s.iter_lines(decode_unicode=True):
                if raw and raw.startswith("data:"):
                    payload = raw[5:].strip()
                    if not payload: continue
                    try: data = json.loads(payload)
                    except Exception: continue
                    if isinstance(data, list):
                        for item in data:
                            blob = item.get("url") or item.get("blob")
                            if isinstance(blob, str) and "/file=" in blob:
                                url = blob if blob.startswith("http") else f"{BASE}{blob}"
                                return url
        except Exception as e:
            print("poll err", str(e)[:60])
        time.sleep(5)
    return url

for key, prompt in PROMPTS.items():
    print(f"\n=== {key} ===")
    t0 = time.time()
    url = gen(prompt)
    if url:
        img = requests.get(url, timeout=120)
        out = rf"c:\Users\hp\forchi\temp_media\img_{key}.png"
        open(out, "wb").write(img.content)
        print(f"OK in {time.time()-t0:.0f}s -> {out} ({len(img.content)} bytes)")
    else:
        print("FAILED (no image)")
