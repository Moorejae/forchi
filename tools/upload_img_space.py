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
folder = r'c:\Users\hp\forchi_img_space'
api.upload_folder(
    repo_id='slymun/forchi-img',
    repo_type='space',
    folder_path=folder,
    commit_message='Fix ZeroGPU: FLUX.1-schnell + spaces.GPU decorator + torchvision',
    ignore_patterns=['.git', '__pycache__', '*.log'],
)
print('Upload complete')
