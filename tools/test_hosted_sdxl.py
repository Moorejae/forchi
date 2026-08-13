# Test radames SDXL-Lightning (predict: prompt, guidance, seed) - lightweight/fast.
import json, time, requests, sys

BASE = "https://radames-real-time-text-to-image-sdxl-lightning.hf.space"
prompt = sys.argv[1] if len(sys.argv) > 1 else "a lone figure walking through rain at night, high-end anime art, lo-fi digital illustration, manga-style painting, soft atmospheric detail"

r = requests.post(f"{BASE}/gradio_api/call/predict", json={"data": [prompt, 0.0, 0]}, timeout=60)
print("POST:", r.status_code, r.text[:200])
if r.status_code != 200:
    sys.exit(1)
eid = r.json().get("event_id")

t0 = time.time()
url = None
for i in range(60):
    try:
        s = requests.get(f"{BASE}/gradio_api/call/predict/{eid}", stream=True, timeout=45)
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
                            url = blob if blob.startswith("http") else f"{BASE}{blob}"
                            img = requests.get(url, timeout=60)
                            out = r"c:\Users\hp\forchi\temp_media\hosted_sdxl.png"
                            open(out, "wb").write(img.content)
                            print(f"\nDONE in {time.time()-t0:.0f}s -> {out} ({len(img.content)} bytes)")
                            sys.exit(0)
    except requests.exceptions.RequestException as e:
        print(f"[{time.time()-t0:.0f}s] poll err {str(e)[:50]}")
    time.sleep(3)
print("FAILED no image")
