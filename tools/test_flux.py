# Single robust FLUX generation test with long wait + clear failure reporting.
import json, time, requests, sys

BASE = "https://slymun-forchi-img.hf.space"
prompt = sys.argv[1] if len(sys.argv) > 1 else "a lone figure walking through rain at night, high-end anime art, lo-fi digital illustration, manga-style painting, soft atmospheric detail, vibrant colors"

print("POST /gradio_api/call/generate ...", flush=True)
try:
    r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": [prompt]}, timeout=90)
    print("POST", r.status_code, r.text[:200], flush=True)
except Exception as e:
    print("POST EXC:", str(e)[:200]); sys.exit(1)
if r.status_code != 200:
    sys.exit(1)
event_id = r.json().get("event_id")
print("event_id:", event_id, flush=True)

t0 = time.time()
url = None
for i in range(240):  # up to ~20 min
    try:
        s = requests.get(f"{BASE}/gradio_api/call/generate/{event_id}", stream=True, timeout=90)
        for raw in s.iter_lines(decode_unicode=True):
            if raw and raw.startswith("data:"):
                payload = raw[5:].strip()
                if not payload:
                    continue
                try:
                    data = json.loads(payload)
                except Exception:
                    continue
                if isinstance(data, list):
                    for item in data:
                        blob = item.get("url") or item.get("blob") or item.get("image")
                        if isinstance(blob, str) and "/file=" in blob:
                            url = blob if blob.startswith("http") else f"{BASE}{blob}"
                            img = requests.get(url, timeout=120)
                            out = r"c:\Users\hp\forchi\temp_media\flux_test.png"
                            open(out, "wb").write(img.content)
                            print(f"\nDONE in {time.time()-t0:.0f}s -> {out} ({len(img.content)} bytes)", flush=True)
                            sys.exit(0)
    except requests.exceptions.RequestException as e:
        print(f"poll exc (retry): {str(e)[:80]}", flush=True)
    time.sleep(5)
print("FAILED: no image within budget")
