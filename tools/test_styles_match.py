# Generate FB (Lucas Alighieri style) + LI (cyberpunk) test images.
# Tries: our ZeroGPU (fp8 FLUX) -> hosted SDXL-Lightning -> Pollinations.
import json, time, requests, sys

PROVIDERS = {
    "zeroGPU": "https://slymun-forchi-img.hf.space",
    "hosted": "https://radames-real-time-text-to-image-sdxl-lightning.hf.space",
}

PROMPTS = {
    "fb": ("ethereal dreamy cinematic digital painting, warm golden hour light, soft glowing atmosphere, "
           "painterly brushstrokes, Lucas Alighieri style, emotional surreal fantasy scene, luminous floating "
           "particles, rich amber and rose tones, melancholic romantic mood, ultra detailed"),
    "li": ("high-end photorealistic cyberpunk mecha, futuristic humanoid robot, neon cyberpunk city at night, "
           "reflective wet streets, cinematic rim lighting, holographic glow, ultra detailed, 8k"),
}

def poll(base, api, eid, out_path):
    t0 = time.time()
    for i in range(80):
        try:
            s = requests.get(f"{base}/gradio_api/call/{api}/{eid}", stream=True, timeout=60)
            for raw in s.iter_lines(decode_unicode=True):
                if raw and raw.startswith("data:"):
                    payload = raw[5:].strip()
                    if not payload:
                        continue
                    try:
                        data = json.loads(payload)
                    except Exception:
                        continue
                    items = data.get("data") if isinstance(data, dict) else data
                    if isinstance(items, list):
                        for item in items:
                            blob = None
                            if isinstance(item, dict):
                                blob = item.get("url") or item.get("blob") or item.get("image")
                            if isinstance(blob, str) and ("/file=" in blob or blob.startswith("http")):
                                u = blob if blob.startswith("http") else f"{base}{blob}"
                                img = requests.get(u, timeout=60)
                                open(out_path, "wb").write(img.content)
                                print(f"   DONE in {time.time()-t0:.0f}s -> {out_path} ({len(img.content)} bytes)")
                                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(3)
    return False

def try_zeroGPU(prompt, out):
    base = "https://slymun-forchi-img.hf.space"
    r = requests.post(f"{base}/gradio_api/call/generate", json={"data": [prompt]}, timeout=60)
    if r.status_code != 200:
        return False, f"POST {r.status_code}"
    eid = r.json().get("event_id")
    return poll(base, "generate", eid, out), "zeroGPU"

def try_hosted(prompt, out):
    base = "https://radames-real-time-text-to-image-sdxl-lightning.hf.space"
    r = requests.post(f"{base}/gradio_api/call/predict", json={"data": [prompt, 0.0, 0]}, timeout=60)
    if r.status_code != 200:
        return False, f"POST {r.status_code}"
    eid = r.json().get("event_id")
    return poll(base, "predict", eid, out), "hosted"

def try_pollinations(prompt, out):
    url = f"https://image.pollinations.ai/prompt/{requests.utils.quote(prompt)}?width=1024&height=1024&nologo=true"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=150)
    if r.status_code == 200 and len(r.content) > 5000:
        open(out, "wb").write(r.content)
        print(f"   Pollinations DONE -> {out} ({len(r.content)} bytes)")
        return True
    return False

for key, prompt in PROMPTS.items():
    print(f"\n=== {key} ===")
    out = rf"c:\Users\hp\forchi\temp_media\style_{key}.png"
    ok, who = try_zeroGPU(prompt, out)
    if not ok:
        print(f"   zeroGPU failed ({who}) — trying hosted...")
        ok, who = try_hosted(prompt, out)
    if not ok:
        print(f"   hosted failed ({who}) — trying Pollinations...")
        ok = try_pollinations(prompt, out)
    print(f"   RESULT: {'OK via ' + who if ok else 'ALL PROVIDERS FAILED'}")
