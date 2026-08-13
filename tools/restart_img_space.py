import time
from huggingface_hub import HfApi

token = [l.split('=', 1)[1].strip().strip('"').strip("'") for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=token)

print("Restarting slymun/forchi-img...")
api.restart_space('slymun/forchi-img')

# Poll until RUNNING (FLUX.1-dev is ~24GB, download + load takes a few minutes)
for i in range(60):
    rt = api.get_space_runtime('slymun/forchi-img')
    print(f"[{i*10}s] stage={rt.stage}", flush=True)
    if rt.stage == 'RUNNING':
        print("Space running. Checking which model loaded...")
        break
    if rt.stage in ('BUILD_ERROR', 'RUNTIME_ERROR'):
        print("ERROR:", rt.stage)
        if hasattr(rt, 'runtime_error'):
            print(rt.runtime_error)
        break
    time.sleep(10)
