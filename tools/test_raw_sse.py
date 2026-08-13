# POST a generation, then dump the RAW SSE response + queue info.
import json, time, requests

BASE = "https://slymun-forchi-img.hf.space"
prompt = "test image, anime style, high quality"

# 1. Inspect the app config (endpoints + queue)
r = requests.get(f"{BASE}/config", timeout=30)
cfg = r.json() if r.status_code == 200 else None
if cfg:
    print("app title:", cfg.get("title") or cfg.get("name"))
    print("queue enabled:", cfg.get("enable_queue"))
    comps = cfg.get("components") or []
    for comp in comps:
        if isinstance(comp, dict) and comp.get("api_name") == "generate":
            print("generate api_name present; type:", comp.get("type"))

# 2. POST generation
print("\nPOST /gradio_api/call/generate ...")
r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": [prompt]}, timeout=60)
print("POST status:", r.status_code, "| body:", r.text[:200])
if r.status_code != 200:
    raise SystemExit(1)
event_id = r.json().get("event_id")
print("event_id:", event_id)

# 3. Raw SSE dump for up to 5 min
print("\n--- RAW SSE stream ---")
t0 = time.time()
try:
    with requests.get(f"{BASE}/gradio_api/call/generate/{event_id}", stream=True, timeout=60) as s:
        for raw in s.iter_lines(decode_unicode=True):
            if not raw:
                continue
            print(f"[{time.time()-t0:5.0f}s] {raw[:200]}")
            if time.time() - t0 > 300:
                print("...timed out waiting")
                break
except Exception as e:
    print("SSE exception:", str(e)[:200])
