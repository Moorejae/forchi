from huggingface_hub import HfApi

t = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
api = HfApi(token=t)
logs = api.fetch_space_logs('slymun/forchi-img')
out = '\n'.join(str(x) for x in (list(logs) if not isinstance(logs, str) else [logs]))
with open(r'c:\Users\hp\forchi\img_space_build_log.txt', 'w', encoding='utf-8') as f:
    f.write(out)
print('build log len:', len(out))
idx = out.find('ERROR')
if idx == -1:
    idx = out.find('error')
print(out[max(0, idx - 500):idx + 2000])
