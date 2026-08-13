import json, time, requests
from huggingface_hub import HfApi

t = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=t)
BASE = "https://slymun-forchi-img.hf.space"

# Dump full runtime raw (may contain quota/usage)
try:
    rt = api.get_space_runtime('slymun/forchi-img')
    print("== runtime.raw ==")
    print(json.dumps(rt.raw, indent=2)[:2000])
except Exception as e:
    print("runtime err:", e)

# Confirm SSE error
print("\n== generation test ==")
r = requests.post(f"{BASE}/gradio_api/call/generate", json={"data": ["test"]}, timeout=60)
print("POST:", r.status_code, r.text[:120])
if r.status_code == 200:
    eid = r.json().get("event_id")
    t0 = time.time()
    with requests.get(f"{BASE}/gradio_api/call/generate/{eid}", stream=True, timeout=60) as s:
        for raw in s.iter_lines(decode_unicode=True):
            if raw:
                print(f"[{time.time()-t0:.0f}s] {raw[:150]}")
            if time.time() - t0 > 60:
                break

# Fresh logs - check for ENTERED / any new lines after running
time.sleep(5)
logs = api.fetch_space_logs('slymun/forchi-img')
out = '\n'.join(str(x) for x in (logs if not isinstance(logs, str) else [logs]))
print("\n== last 800 chars of log ==")
print(out[-800:])
