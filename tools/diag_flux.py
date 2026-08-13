# Wait for FLUX to load, then trigger a generation and dump the real error from logs.
import time, json, requests

BASE = "https://slymun-forchi-img.hf.space"
t = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
from huggingface_hub import HfApi
api = HfApi(token=t)

# 1. Wait until "Active model" appears in logs (model loaded)
print("Waiting for FLUX to load...", flush=True)
for i in range(60):
    try:
        logs = api.fetch_space_logs('slymun/forchi-img')
        out = '\n'.join(str(x) for x in (logs if not isinstance(logs, str) else [logs]))
        if 'Active model: FLUX.1-dev' in out:
            print(f"[{i*10}s] FLUX loaded", flush=True)
            break
    except Exception as e:
        print('log fetch err', str(e)[:60], flush=True)
    time.sleep(10)
else:
    print("Timed out waiting for FLUX load")

# 2. Trigger generation
prompt = "a lone figure walking through rain at night, high-end anime art, lo-fi digital illustration, manga-style painting"
print("POST generation...", flush=True)
try:
    r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": [prompt]}, timeout=90)
    print("POST", r.status_code, r.text[:150], flush=True)
    event_id = r.json().get("event_id") if r.status_code == 200 else None
except Exception as e:
    print("POST exc", str(e)[:100], flush=True)
    event_id = None

# 3. Give the generation time to run (and fail), then read logs for GENERATION ERROR
time.sleep(90)
print("\n--- Looking for generation error in logs ---", flush=True)
logs = api.fetch_space_logs('slymun/forchi-img')
out = '\n'.join(str(x) for x in (logs if not isinstance(logs, str) else [logs]))
idx = out.find('GENERATION ERROR')
if idx >= 0:
    print(out[idx:idx + 2500])
else:
    idx2 = out.find('Traceback')
    print("No 'GENERATION ERROR' marker. Last traceback:")
    print(out[max(0, idx2 - 200):idx2 + 2500] if idx2 >= 0 else out[-1500:])
