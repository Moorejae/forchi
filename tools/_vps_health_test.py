# Test the new vps.js health + repair on the VPS (via SFTP-written node script).
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
const vps = require("/opt/forchi/src/scheduler/vps.js");
(async () => {
  const h = await vps.getVpsHealth();
  console.log("VPS_HEALTH:", JSON.stringify(h));
  const acts = await vps.repairVps();
  console.log("REPAIR_ACTIONS:");
  acts.forEach((a) => console.log(" -", a));
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
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
    with sftp.open("/tmp/vpstest.js", "w") as f:
        f.write(TEST)
    sftp.close()
    i, o, e = c.exec_command("cd /opt/forchi && timeout 40 node /tmp/vpstest.js", timeout=60)
    o.channel.settimeout(50)
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
