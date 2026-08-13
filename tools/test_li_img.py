import json, time, requests

BASE = "https://slymun-forchi-img.hf.space"
prompt = "futuristic robotic mecha in a neon cyberpunk city, high-end photorealistic tech image, cyberpunk mecha digital art, futuristic robotics aesthetic, cinematic lighting, ultra detailed"

r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": [prompt]}, timeout=60)
print("POST", r.status_code)
event_id = r.json().get("event_id")
url = None
for i in range(200):
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
                            img = requests.get(url, timeout=120)
                            out = r"c:\Users\hp\forchi\temp_media\img_li.png"
                            open(out, "wb").write(img.content)
                            print("OK ->", out, len(img.content), "bytes")
                            raise SystemExit(0)
    except SystemExit:
        raise
    except Exception as e:
        print("poll err", str(e)[:60])
    time.sleep(5)
print("FAILED")
