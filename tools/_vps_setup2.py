# VPS setup part 2: transfer .env (SFTP) + pull/unpack the HF asset bundle.
import os
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


def main():
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("connecting...")
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)

    # 1. transfer .env
    sftp = client.open_sftp()
    local_env = os.path.join(BASE, ".env")
    remote_env = "/opt/forchi/.env"
    sftp.put(local_env, remote_env)
    sftp.close()
    print(".env transferred ->", remote_env)

    # 2. pull + unpack assets
    remote = (
        "cd /opt/forchi && "
        "FORCHI_BASE=/opt/forchi .venv/bin/python tools/fetch_assets.py"
    )
    stdin, stdout, stderr = client.exec_command(remote, timeout=900)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if err.strip():
        print("STDERR:", err.strip()[:1500])
    print("exit=", rc)

    # 3. sanity: counts on disk
    stdin, stdout, stderr = client.exec_command(
        "ls /opt/forchi/media/clips/segments | wc -l; ls /opt/forchi/.instrumental | wc -l; ls -la /opt/forchi/media/clips/manifest.json 2>/dev/null || echo no-manifest",
        timeout=30,
    )
    print(stdout.read().decode(errors="replace"))
    client.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
