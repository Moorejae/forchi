# Reproduce the video assembly step on the VPS with the failed run's own inputs.
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
import sys, json, os
sys.path.insert(0, "/opt/forchi/tools")
os.environ["FORCHI_BASE"] = "/opt/forchi"
from _video_assemble import assemble
d = json.load(open("/opt/forchi/temp_media/vm_541228_run.json"))
phrases = d["phrases"]
wavs = ["/opt/forchi/temp_media/vm_541228_parts/p%d.wav" % i for i in range(1, len(phrases) + 1)]
clips = d["clips"]
print("phrases", len(phrases), "wavs", len(wavs), "clips", len(clips), flush=True)
out = assemble(phrases, wavs, clips, "repro_test", music=True, seed=1)
print("RETURNED", out, "exists=", os.path.exists(out), flush=True)
print("build:", sorted(os.listdir("/opt/forchi/temp_media/assemble_build")), flush=True)
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
    with sftp.open("/tmp/repro_asm.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command(
        "cd /opt/forchi && /opt/forchi/.venv/bin/python /tmp/repro_asm.py", timeout=300
    )
    o.channel.settimeout(240)
    try:
        out = o.read().decode(errors="replace")
        print(out)
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:2000])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
