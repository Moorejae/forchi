from huggingface_hub import HfApi

t = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=t)
logs = api.fetch_space_logs('slymun/forchi-img')
lines = list(logs) if not isinstance(logs, str) else [logs]
out = '\n'.join(str(x) for x in lines)

with open(r'c:\Users\hp\forchi\img_space_log.txt', 'w', encoding='utf-8') as f:
    f.write(out)
print('log len:', len(out))

idx = out.find('Traceback')
if idx == -1:
    idx = out.find('Error')
if idx == -1:
    idx = out.find('Loading')
print('--- around error ---')
print(out[max(0, idx - 300):idx + 1800])
