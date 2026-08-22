# Test build_bed loops a short instrumental to the full bed duration.
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

TEST = r"""
import sys, os, subprocess
sys.path.insert(0, "/opt/forchi/tools")
os.environ["FORCHI_BASE"] = "/opt/forchi"
from _video_music import build_bed, pick_instrumental, INSTR_DIR
# find a short instrumental (or any) to test with
src = pick_instrumental()
print("instr:", src)
if not src or not os.path.exists(src):
    print("NO INSTRUMENTAL - using a generated piano track")
    from _video_music import make_track, PROGS, RHYTHM, save
    src = save("piano_romantic", make_track(PROGS["romantic"], RHYTHM["romantic"], dur=60, seed=7))
def dur(p):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)
print("src_dur:", round(dur(src), 1))
out = "/tmp/bed_test.wav"
build_bed(src, 45.0, out, fade_out_st=44.0)
print("bed_dur:", round(dur(out), 1), "(expected ~45.0 - the full video length)")
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
    with sftp.open("/tmp/bedtest.py", "w") as f:
        f.write(TEST)
    sftp.close()
    i, o, e = c.exec_command("cd /opt/forchi && timeout 90 /opt/forchi/.venv/bin/python /tmp/bedtest.py", timeout=110)
    o.channel.settimeout(100)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:600])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
