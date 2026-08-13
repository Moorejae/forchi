import json, time, requests
from huggingface_hub import HfApi

t = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=t)
BASE = "https://slymun-forchi-img.hf.space"

# 1. Runtime + any quota info
try:
    rt = api.get_space_runtime('slymun/forchi-img')
    print("runtime stage:", rt.stage)
    print("runtime attrs:", [a for a in dir(rt) if not a.startswith('_')])
except Exception as e:
    print("runtime err:", e)

# 2. Gradio queue status
for path in ["/gradio_api/queue/status", "/queue/status", "/gradio_api/queue/data"]:
    try:
        r = requests.get(f"{BASE}{path}", timeout=15)
        print(path, r.status_code, r.text[:200])
    except Exception as e:
        print(path, "err", str(e)[:80])

# 3. Trigger a job then check logs for ENTERED quickly
r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": ["test"]}, timeout=60)
print("\nPOST:", r.status_code, r.text[:120])
event_id = r.json().get("event_id") if r.status_code == 200 else None
time.sleep(20)
logs = api.fetch_space_logs('slymun/forchi-img')
out = '\n'.join(str(x) for x in (logs if not isinstance(logs, str) else [logs]))
print("\nlog len:", len(out))
for marker in ["ENTERED", "GENERATION ERROR", "FINISHED", "error", "Error", "quota", "Quota"]:
    i = out.find(marker)
    if i >= 0:
        print(f"\n{marker} found at {i}:")
        print(out[max(0, i - 150):i + 300])
