# Upload the compressed video-assets bundle (clips + music) to a private HF dataset
# so any host (Render/VPS/Oracle/own PC) can pull it at boot for the auto pipeline.
# NOTE: HF's default Xet backend (cas-server.xethub.hf.co) was unreachable from this
# network -> force the REGULAR upload path (HF_HUB_DISABLE_XET=1) and retry a few times.
import os
import sys
import time

os.environ["HF_HUB_DISABLE_XET"] = "1"  # must be set before importing huggingface_hub
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

from huggingface_hub import HfApi  # noqa: E402

REPO = "slymun/forchi-assets"
ZIP = os.path.join(r"c:\Users\hp\forchi", "media", "assets_bundle.zip")
REMOTE_PATH = "assets_bundle.zip"
ATTEMPTS = 3


def main():
    token = os.environ.get("HF_ACCESS_TOKEN") or os.environ.get("HF_TOKEN") or ""
    if not token:
        print("no HF_ACCESS_TOKEN/HF_TOKEN in env")
        return 1
    if not os.path.exists(ZIP):
        print("bundle missing:", ZIP)
        return 1
    api = HfApi(token=token)
    try:
        api.create_repo(repo_id=REPO, repo_type="dataset", private=True, exist_ok=True)
    except Exception as e:
        print("create_repo warn:", e)
    size_mb = os.path.getsize(ZIP) / 1048576
    print(f"uploading {ZIP} ({size_mb:.1f} MB) -> {REPO}/{REMOTE_PATH} (regular path, xet disabled) ...")
    for attempt in range(1, ATTEMPTS + 1):
        try:
            api.upload_file(
                path_or_fileobj=ZIP,
                path_in_repo=REMOTE_PATH,
                repo_id=REPO,
                repo_type="dataset",
            )
            print("uploaded OK (file already present counts as success)")
            print("resolve URL:", f"https://huggingface.co/datasets/{REPO}/resolve/main/{REMOTE_PATH}")
            return 0
        except Exception as e:
            print(f"attempt {attempt}/{ATTEMPTS} failed: {str(e).strip().splitlines()[-1]}")
            if attempt < ATTEMPTS:
                time.sleep(5)
    return 1


if __name__ == "__main__":
    sys.exit(main())
