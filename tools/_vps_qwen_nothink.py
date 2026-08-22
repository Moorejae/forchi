# Restart the Qwen server with thinking mode DISABLED (Qwen3 chat_template_kwargs)
# via a wrapper script (avoids systemd ExecStart quoting hell).
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

WRAPPER = """#!/bin/bash
exec /opt/qwen/.venv/bin/python -m llama_cpp.server \\
  --model /opt/qwen/models/Qwen3-4B-Q6_K.gguf \\
  --host 127.0.0.1 --port 8080 \\
  --n_gpu_layers 0 --n_ctx 4096 \\
  --chat_template_kwargs '{"enable_thinking": false}'
"""

UNIT = """[Unit]
Description=Local Qwen chat model (llama.cpp OpenAI-compatible server)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/qwen
ExecStart=/opt/qwen/run_server.sh
Restart=always
RestartSec=5
Environment=LLAMA_CACHE=/opt/qwen/models

[Install]
WantedBy=multi-user.target
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
    with sftp.open("/opt/qwen/run_server.sh", "w") as f:
        f.write(WRAPPER)
    with sftp.open("/etc/systemd/system/qwen.service", "w") as f:
        f.write(UNIT)
    sftp.close()
    i, o, e = c.exec_command(
        "chmod +x /opt/qwen/run_server.sh && systemctl daemon-reload && systemctl restart qwen && "
        "sleep 8 && systemctl is-active qwen", timeout=120)
    o.channel.settimeout(90)
    try:
        print(o.read().decode(errors="replace"))
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    print("restarted (thinking disabled) — will finish loading shortly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
