import json
import time
import requests
from huggingface_hub import HfApi

token = [l.split('=', 1)[1].strip().strip('"').strip("'") for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=token)
BASE = "https://slymun-forchi-img.hf.space"

# 1) Wait for the app to be fully ready (health/config endpoint reachable)
print("[img] Waiting for app to be ready...", flush=True)
ready = False
for i in range(60):  # up to 10 min
    try:
        r = requests.get(f"{BASE}/config", timeout=10)
        if r.status_code == 200:
            ready = True
            print("[img] /config reachable (HTTP", r.status_code, ")", flush=True)
            break
    except Exception:
        pass
    time.sleep(10)
if not ready:
    print("[img] App not reachable yet. Dumping logs...", flush=True)
    logs = api.fetch_space_logs('slymun/forchi-img')
    out = '\n'.join(str(x) for x in logs) if not isinstance(logs, str) else logs
    print(out[-2000:])
    raise SystemExit(1)

prompt = "A quiet sunrise over a misty lake, oil painting style, rich brushstrokes, painterly, warm golden light"

print(f"[img] Submitting prompt: {prompt[:60]}...")
r = requests.post(
    f"{BASE}/gradio_api/call/generate",
    json={"data": [prompt]},
    timeout=60,
)
print("[img] POST status:", r.status_code)
print("[img] POST body:", r.text[:500])
if r.status_code != 200:
    raise SystemExit("POST failed")

event_id = r.json().get("event_id")
print("[img] event_id:", event_id)

# Poll SSE until we get the final result
url = None
for i in range(180):  # up to ~18 min
    try:
        s = requests.get(
            f"{BASE}/gradio_api/call/generate/{event_id}",
            stream=True,
            timeout=60,
        )
        for raw in s.iter_lines(decode_unicode=True):
            if not raw:
                continue
            if raw.startswith("data:"):
                payload = raw[5:].strip()
                if not payload:
                    continue
                try:
                    data = json.loads(payload)
                except Exception:
                    continue
                if isinstance(data, list):
                    for item in data:
                        blob = item.get("blob") or item.get("url") or item.get("image")
                        if isinstance(blob, str) and ("/file=" in blob or "gradio" in blob):
                            url = blob if blob.startswith("http") else f"{BASE}{blob}"
                            print("[img] RESULT URL:", url)
                            break
        if url:
            break
    except requests.exceptions.RequestException as e:
        print(f"[img] poll err (retry): {e}")
    time.sleep(5)

if not url:
    print("[img] No image URL found within time budget.")
    raise SystemExit(1)

# Download the image bytes
img = requests.get(url, timeout=120)
print("[img] Image download status:", img.status_code, "bytes:", len(img.content))
if img.status_code == 200 and len(img.content) > 1000:
    out = r"c:\Users\hp\forchi\temp_media\zero_gpu_test.png"
    with open(out, "wb") as f:
        f.write(img.content)
    print("[img] Saved to", out)
else:
    print("[img] First 300 bytes:", img.content[:300])
