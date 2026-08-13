import os
from huggingface_hub import HfApi

# Read token from .env to avoid committing secrets
token = None
for line in open(r'c:\Users\hp\forchi\.env', encoding='utf-8'):
    line = line.strip()
    if line.startswith('HF_ACCESS_TOKEN='):
        token = line.split('=', 1)[1].strip().strip('"').strip("'")
        break
if not token:
    raise SystemExit('HF_ACCESS_TOKEN not found in .env')

api = HfApi(token=token)

# Ensure the Space has an HF_TOKEN secret so it can download the gated FLUX.1-dev
# model once the license is accepted on the account.
try:
    api.add_space_secret('slymun/forchi-img', 'HF_TOKEN', token)
    print('HF_TOKEN secret set on Space.')
except Exception as e:
    print('add_space_secret skipped:', e)

folder = r'c:\Users\hp\forchi_img_space'
api.upload_folder(
    repo_id='slymun/forchi-img',
    repo_type='space',
    folder_path=folder,
    commit_message='FLUX.1-dev primary w/ DreamShaper XL fallback (high quality images)',
    ignore_patterns=['.git', '__pycache__', '*.log'],
)
print('Upload complete')
