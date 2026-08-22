# Enable the video auto-poster on the VPS: write video_mode.json enabled=true and
# restart forchi.service so the VideoScheduler starts its 15-50 min jitter loop.
import datetime
import json
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
    mode = {
        "enabled": True,
        "updatedAt": datetime.datetime.utcnow().isoformat() + "Z",
    }
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)

    sftp = client.open_sftp()
    try:
        sftp.mkdir("/opt/forchi/temp_media")
    except Exception:
        pass
    with sftp.open("/opt/forchi/temp_media/video_mode.json", "w") as f:
        f.write(json.dumps(mode))
    sftp.close()
    print("video_mode.json written:", json.dumps(mode))

    stdin, stdout, stderr = client.exec_command(
        "systemctl restart forchi; sleep 7; "
        "echo ---video---; journalctl -u forchi --no-pager -n 30 | grep -iE 'video|short' | tail -6; "
        "echo ---active---; systemctl is-active forchi",
        timeout=120,
    )
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err.strip()[:1200])
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
