# Test the v61 serve message handlers on the VPS (commands + Qwen-only chat).
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
import sys
sys.path.insert(0, "/opt/v61")
import telegram_bot as t

hist, ni, lib = t.load_runtime()
print("runtime: hist=%d lib=%d" % (len(hist), len(lib)))

r1 = t.handle_message("/status", None, hist, ni, lib)
print("STATUS:", r1.replace("\n", " | ")[:300])

r2 = t.handle_message("/help", None, hist, ni, lib)
print("HELP ok:", bool(r2))

print("QWEN...")
r3 = t.handle_message("tell me what V61 predicts today and what odds-free means", None, hist, ni, lib)
print("QWEN:", r3[:400])
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
    with sftp.open("/tmp/v61serve_test.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command(
        "cd /opt/v61 && timeout 120 /opt/v61/.venv/bin/python /tmp/v61serve_test.py",
        timeout=140)
    o.channel.settimeout(120)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:1200])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
