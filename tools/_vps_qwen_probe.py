# Timed chat-completion probe against the local Qwen server (body written via
# SFTP so there are zero shell-quoting issues).
import json
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

BODY = json.dumps({
    "model": "qwen2.5-7b",
    "messages": [{"role": "user", "content": "Say hello in exactly 5 words"}],
    "max_tokens": 32,
    "temperature": 0.7,
})

PROBE = r"""
import json, time, urllib.request
body = open("/tmp/qwen_body.json").read()
req = urllib.request.Request("http://127.0.0.1:8080/v1/chat/completions",
    data=body.encode(), headers={"Content-Type": "application/json"})
t0 = time.time()
try:
    r = urllib.request.urlopen(req, timeout=180)
    d = json.loads(r.read().decode())
    dt = time.time() - t0
    msg = d["choices"][0]["message"]["content"]
    print("REPLY:", msg)
    print("SECONDS: %.1f" % dt)
    print("TOKENS:", d.get("usage"))
except Exception as e:
    print("ERR:", repr(e)[:400])
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
    with sftp.open("/tmp/qwen_body.json", "w") as f:
        f.write(BODY)
    with sftp.open("/tmp/qwen_probe.py", "w") as f:
        f.write(PROBE)
    sftp.close()
    i, o, e = c.exec_command("/opt/qwen/.venv/bin/python /tmp/qwen_probe.py", timeout=220)
    o.channel.settimeout(200)
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
