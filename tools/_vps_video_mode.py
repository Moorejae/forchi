# Set the video auto-poster on/off on the VPS (SFTP-writes video_mode.json, no
# shell quoting issues) and restart forchi so the in-memory scheduler state syncs.
# Usage: python tools/_vps_video_mode.py on|off
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
    arg = (sys.argv[1] if len(sys.argv) > 1 else "on").lower()
    enabled = arg in ("on", "true", "1", "enable", "yes")
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD")
        return 1
    mode = {
        "enabled": enabled,
        "updatedAt": datetime.datetime.utcnow().isoformat() + "Z",
    }
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=30)

    sftp = client.open_sftp()
    try:
        sftp.mkdir("/opt/forchi/temp_media")
    except Exception:
        pass
    with sftp.open("/opt/forchi/temp_media/video_mode.json", "w") as f:
        f.write(json.dumps(mode))
    sftp.close()
    print("video_mode.json ->", json.dumps(mode))

    stdin, stdout, stderr = client.exec_command(
        "systemctl restart forchi; sleep 6; systemctl is-active forchi",
        timeout=120,
    )
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err.strip()[:800])
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
