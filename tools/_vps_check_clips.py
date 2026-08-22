# SFTP-write a diagnostic python to the VPS and run it — no shell quoting issues.
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

DIAG = r"""
import json, os
d = json.load(open("/opt/forchi/temp_media/vm_541228_run.json"))
clips = d["clips"]
print("n_clips", len(clips))
for c in clips:
    print(os.path.exists(c["path"]), c["path"])
print("OUTPUT_EXISTS", os.path.exists(d.get("output", "/none")))
print("parts", os.listdir("/opt/forchi/temp_media/vm_541228_parts"))
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
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, password=pw, timeout=30)
    sftp = c.open_sftp()
    with sftp.open("/tmp/check_clips.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command("/opt/forchi/.venv/bin/python /tmp/check_clips.py", timeout=120)
    o.channel.settimeout(90)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:1000])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
