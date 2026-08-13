import time
from huggingface_hub import HfApi

token = [l.split('=', 1)[1].strip().strip('"').strip("'") for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=token)

for i in range(30):
    rt = api.get_space_runtime('slymun/forchi')
    print(f"[{i*10}s] stage={rt.stage}", flush=True)
    if rt.stage == 'RUNNING':
        print('BUILD/DEPLOY DONE - checking HEAD...')
        break
    if rt.stage in ('BUILD_ERROR', 'RUNTIME_ERROR'):
        print('ERROR state:', rt.stage)
        if hasattr(rt, 'runtime_error'):
            print(rt.runtime_error)
        break
    time.sleep(10)
