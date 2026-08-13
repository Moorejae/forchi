import time
from huggingface_hub import HfApi

token = [l.split('=', 1)[1].strip().strip('"').strip("'") for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=token)

for i in range(20):
    rt = api.get_space_runtime('slymun/forchi-img')
    state = rt.stage
    print(f"[{i*10}s] stage={state}", flush=True)
    if state == 'RUNNING':
        print('--- hardware ---')
        print(rt.hardware if hasattr(rt, 'hardware') else 'n/a')
        break
    if state in ('RUNTIME_ERROR', 'BUILD_ERROR', 'PAUSED', 'STOPPED', 'APP_STARTING', 'APP_RUNNING'):
        print('--- error ---')
        if hasattr(rt, 'runtime_error'):
            print(rt.runtime_error)
        if state in ('RUNTIME_ERROR', 'BUILD_ERROR', 'PAUSED', 'STOPPED'):
            break
    time.sleep(10)
