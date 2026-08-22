# VPS setup for the v61-odonata-engine: clone repo + venv + deps.
# Uses the forchi GitHub PAT (verified to also access Moorejae/v61-odonata-engine).
import os
import subprocess
import sys

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"


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


def local_pat():
    try:
        r = subprocess.run(["git", "config", "--get", "remote.github.url"], cwd=BASE, capture_output=True, text=True)
        url = r.stdout.strip()
        if "@" in url and "//" in url:
            return url.split("//", 1)[1].split("@", 1)[0]
    except Exception:
        pass
    return None


def main():
    pw = env("CONTABO_LOGIN_PASSWORD")
    pat = local_pat()
    if not pw or not pat:
        print("missing CONTABO_LOGIN_PASSWORD or PAT")
        return 1
    clone_url = f"https://{pat}@github.com/Moorejae/v61-odonata-engine.git"
    remote = f"""
set -e
export DEBIAN_FRONTEND=noninteractive
if [ ! -d /opt/v61/.git ]; then
  git clone {clone_url} /opt/v61
else
  cd /opt/v61 && git pull --ff-only
fi
cd /opt/v61
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -q -r requirements.txt
echo V61_SETUP_DONE
.venv/bin/python --version
"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("connecting...")
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)
    stdin, stdout, stderr = client.exec_command(remote, timeout=600)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if err.strip():
        print("STDERR:", err.strip()[:1500])
    print("exit=", rc)
    client.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
