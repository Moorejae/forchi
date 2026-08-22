# Start the local Qwen llama.cpp server on the VPS + point ForChi's chat at it.
# Run AFTER _vps_qwen_setup.py (model downloaded).
import os
import sys
import time

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

UNIT = """[Unit]
Description=Local Qwen chat model (llama.cpp OpenAI-compatible server)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/qwen
ExecStart=/opt/qwen/.venv/bin/python -m llama_cpp.server --model /opt/qwen/models/Qwen3-4B-Q6_K.gguf --host 127.0.0.1 --port 8080 --n_gpu_layers 0 --n_ctx 4096
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
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)

    sftp = client.open_sftp()
    with sftp.open("/etc/systemd/system/qwen.service", "w") as f:
        f.write(UNIT)
    sftp.close()
    print("qwen.service written")

    remote = """
systemctl daemon-reload && systemctl enable qwen >/dev/null 2>&1 && systemctl restart qwen
sleep 3
systemctl is-active qwen
"""
    stdin, stdout, stderr = client.exec_command(remote, timeout=60)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print(out.rstrip())
    if err.strip():
        print("STDERR:", err.strip()[:500])

    # wait for model load, then probe
    print("waiting for model load...")
    time.sleep(25)
    probe = (
        "echo ---models---; curl -s -m 5 http://127.0.0.1:8080/v1/models | head -c 300; echo; "
        "echo ---chat---; t0=$(date +%s); curl -s -m 120 http://127.0.0.1:8080/v1/chat/completions "
        "-H 'Content-Type: application/json' "
        "-d '{\"model\":\"qwen2.5-7b\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with just: OK\"}],\"max_tokens\":16}' "
        "| head -c 400; echo; t1=$(date +%s); echo seconds=$((t1-t0))"
    )
    stdin, stdout, stderr = client.exec_command(probe, timeout=180)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    cerr = stderr.read().decode(errors="replace")
    if cerr.strip():
        print("STDERR:", cerr.strip()[:500])

    # point ForChi's chat at the local server
    patch = (
        "sed -i 's|^LLM_ENDPOINT=.*|LLM_ENDPOINT=http://127.0.0.1:8080|' /opt/forchi/.env && "
        "grep '^LLM_ENDPOINT' /opt/forchi/.env && "
        "systemctl restart forchi && echo FORCHI_RESTARTED"
    )
    stdin, stdout, stderr = client.exec_command(patch, timeout=60)
    out = stdout.read().decode(errors="replace")
    print(out.rstrip())
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
