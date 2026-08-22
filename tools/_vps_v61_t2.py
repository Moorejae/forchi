# Step-wise test of the v61 Qwen chat + handler with unbuffered output.
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
import sys, time
sys.path.insert(0, "/opt/v61")
t0 = time.time()
import telegram_bot as t
print("imported in %.1fs" % (time.time() - t0), flush=True)

print("QWEN direct:", flush=True)
print(t.qwen_chat("In one short sentence, what is a dragonfly pattern prediction?"), flush=True)

print("STATUS handler:", flush=True)
print(t.handle_message("/status", None, t.load_football_history(), t.build_name_index(t.load_football_history()), t.load_library()).replace("\n", " | ")[:300], flush=True)
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
    with sftp.open("/tmp/v61t2.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command(
        "cd /opt/v61 && timeout 150 /opt/v61/.venv/bin/python -u /tmp/v61t2.py",
        timeout=170)
    o.channel.settimeout(150)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:800])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
