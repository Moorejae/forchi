# VPS setup for the local Qwen chat model: venv + llama-cpp-python + download GGUF.
import os
import sys

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

DOWNLOAD_PY = """import os
os.environ["HF_HUB_DISABLE_XET"] = "1"
from huggingface_hub import hf_hub_download
p = hf_hub_download(repo_id="unsloth/Qwen3-4B-GGUF", filename="Qwen3-4B-Q6_K.gguf", local_dir="/opt/qwen/models")
print("downloaded", p, round(os.path.getsize(p) / 1073741824, 2), "GB")
"""


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
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("connecting...")
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)

    sftp = client.open_sftp()
    try:
        sftp.mkdir("/opt/qwen")
    except Exception:
        pass
    with sftp.open("/opt/qwen/download.py", "w") as f:
        f.write(DOWNLOAD_PY)
    sftp.close()

    remote = """
set -e
cd /opt/qwen
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -q llama-cpp-python huggingface_hub
echo INSTALL_DONE
.venv/bin/python download.py
echo DOWNLOAD_DONE
"""
    stdin, stdout, stderr = client.exec_command(remote, timeout=1800)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if err.strip():
        print("STDERR:", err.strip()[:2000])
    print("exit=", rc)
    client.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
