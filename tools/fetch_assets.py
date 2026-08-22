# fetch_assets.py — download + unpack the video asset bundle from HF on a NEW host
# (VPS / Oracle VM / reworked Render), so the auto pipeline has clips + music.
# Run once at boot:  python tools/fetch_assets.py
#
# Downloads media/assets_bundle.zip (private repo, needs HF_ACCESS_TOKEN/HF_TOKEN)
# and unpacks into the exact locations the video tools expect:
#   clips/    -> media/clips/segments/
#   music/    -> .instrumental/
#   manifest.json (if present) -> media/clips/manifest.json
import os
import sys
import zipfile

os.environ["HF_HUB_DISABLE_XET"] = "1"  # must be before huggingface_hub import

from huggingface_hub import hf_hub_download  # noqa: E402

from _paths import BASE  # repo root, override with FORCHI_BASE env on a VPS
REPO = "slymun/forchi-assets"
REMOTE_PATH = "assets_bundle.zip"


def _load_env():
    """Parse BASE/.env into os.environ (the tools run standalone, not via the node bot)."""
    try:
        with open(os.path.join(BASE, ".env"), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


def main():
    _load_env()
    token = os.environ.get("HF_ACCESS_TOKEN") or os.environ.get("HF_TOKEN") or ""
    if not token:
        print("no HF_ACCESS_TOKEN/HF_TOKEN")
        return 1
    zip_path = hf_hub_download(
        repo_id=REPO,
        filename=REMOTE_PATH,
        repo_type="dataset",
        token=token,
        local_dir=os.path.join(BASE, "media"),
    )
    print("downloaded:", zip_path, f"({os.path.getsize(zip_path)/1048576:.1f} MB)")

    # the stitcher's index (manifest.json) lives as its own file on the dataset
    seg = os.path.join(BASE, "media", "clips", "segments")
    instr = os.path.join(BASE, ".instrumental")
    os.makedirs(seg, exist_ok=True)
    os.makedirs(instr, exist_ok=True)

    count = {"clips": 0, "music": 0}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if name.startswith("clips/") and name.endswith(".mp4"):
                out = os.path.join(seg, os.path.basename(name))
                with open(out, "wb") as f:
                    f.write(z.read(name))
                count["clips"] += 1
            elif name.startswith("music/"):
                out = os.path.join(instr, os.path.basename(name))
                with open(out, "wb") as f:
                    f.write(z.read(name))
                count["music"] += 1
            elif name == "manifest.json":
                out = os.path.join(BASE, "media", "clips", "manifest.json")
                with open(out, "wb") as f:
                    f.write(z.read(name))
    # manifest.json (clip index) fetched separately from the dataset
    try:
        man = hf_hub_download(
            repo_id=REPO,
            filename="manifest.json",
            repo_type="dataset",
            token=token,
            local_dir=os.path.join(BASE, "media", "clips"),
        )
        os.replace(man, os.path.join(BASE, "media", "clips", "manifest.json"))
        print("manifest.json ->", os.path.join(BASE, "media", "clips", "manifest.json"))
    except Exception as e:
        print("manifest fetch skipped:", str(e).strip().splitlines()[-1])
    print("unpacked:", count, "->", seg, "and", instr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
