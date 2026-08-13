import json
import requests

token = [l.split('=', 1)[1].strip().strip('"').strip("'") for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]

# Check space API for build status details
r = requests.get(
    'https://huggingface.co/api/spaces/slymun/forchi-img',
    headers={'Authorization': f'Bearer {token}'},
    timeout=30,
)
data = r.json()
print('=== space api ===')
print('stage:', data.get('runtime', {}).get('stage'))
print('sdk:', data.get('sdk'))
print('sdk_version:', data.get('sdk_version'))
print('hardware:', data.get('runtime', {}).get('hardware'))
print('created:', data.get('createdAt'))

# Try the build endpoint
for path in ['/api/spaces/slymun/forchi-img/builds', '/api/spaces/slymun/forchi-img/build']:
    try:
        b = requests.get('https://huggingface.co' + path, headers={'Authorization': f'Bearer {token}'}, timeout=30)
        print(f'=== {path} -> {b.status_code} ===')
        print(b.text[:2000])
    except Exception as e:
        print(path, 'err', e)
