# Ship media/clips/manifest.json (the clip stitcher's index) to the VPS now AND
# to the HF dataset so fetch_assets pulls it on any future host.
import os
import sys

os.environ["HF_HUB_DISABLE_XET"] = "1"  # before importing huggingface_hub

from huggingface_hub import HfApi  # noqa: E402
import paramiko  # noqa: E402

BASE = r"c:\Users\hp\forchi"
MANIFEST = os.path.join(BASE, "media", "clips", "manifest.json")
HOST = "217.77.1.187"
USER = "root"
HF_REPO = "slymun/forchi-assets"
REMOTE_MANIFEST = "/opt/forchi/media/clips/manifest.json"


def env(k):
    try:
        with open(os.path.join(BASE, ".env"), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(k + "="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return os.environ.get(k, "").strip()


def main():
    if not os.path.exists(MANIFEST):
        print("manifest missing locally:", MANIFEST)
        return 1
    hf_token = env("HF_ACCESS_TOKEN") or env("HF_TOKEN")
    if hf_token:
        try:
            api = HfApi(token=hf_token)
            api.create_repo(repo_id=HF_REPO, repo_type="dataset", private=True, exist_ok=True)
            api.upload_file(path_or_fileobj=MANIFEST, path_in_repo="manifest.json", repo_id=HF_REPO, repo_type="dataset")
            print("manifest uploaded to HF dataset")
        except Exception as e:
            print("HF upload warn:", str(e).strip().splitlines()[-1])
    else:
        print("no HF token - skipping HF upload")

    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)
    sftp = client.open_sftp()
    try:
        sftp.mkdir("/opt/forchi/media/clips")
    except Exception:
        pass
    sftp.put(MANIFEST, REMOTE_MANIFEST)
    sftp.close()
    print("manifest ->", REMOTE_MANIFEST, os.path.getsize(MANIFEST), "bytes")
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
