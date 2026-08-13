# Verify: raw gradio API + x-hf-authorization header (the auth gradio_client uses).
import json, time, requests

token = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
BASE = "https://radames-real-time-text-to-image-sdxl-lightning.hf.space"
HDRS = {
    "Content-Type": "application/json",
    "x-hf-authorization": f"Bearer {token}",
    "User-Agent": "Mozilla/5.0",
}
SSE_HDRS = {
    "x-hf-authorization": f"Bearer {token}",
    "User-Agent": "Mozilla/5.0",
}

prompt = "ethereal dreamy cinematic digital painting, warm golden light, Lucas Alighieri style, painterly, ultra detailed"

print("POST /gradio_api/call/predict with x-hf-authorization...")
r = requests.post(f"{BASE}/gradio_api/call/predict", json={"data": [prompt, 0.0, 0]}, headers=HDRS, timeout=60)
print("POST:", r.status_code, r.text[:150])
if r.status_code != 200:
    raise SystemExit(1)
eid = r.json().get("event_id")

t0 = time.time()
url = None
for i in range(60):
    try:
        s = requests.get(f"{BASE}/gradio_api/call/predict/{eid}", headers=SSE_HDRS, stream=True, timeout=45)
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
                            u = blob if blob.startswith("http") else f"{BASE}{blob}"
                            img = requests.get(u, headers=SSE_HDRS, timeout=60)
                            out = r"c:\Users\hp\forchi\temp_media\auth_raw.png"
                            open(out, "wb").write(img.content)
                            print(f"\nDONE in {time.time()-t0:.0f}s -> {out} ({len(img.content)} bytes)")
                            raise SystemExit(0)
    except SystemExit:
        raise
    except requests.exceptions.RequestException as e:
        print(f"[{time.time()-t0:.0f}s] poll err {str(e)[:60]}")
    time.sleep(3)
print("FAILED no image")
