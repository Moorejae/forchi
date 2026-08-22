# Test ForChi self-healing: stop qwen (real issue), verify detection + repair.
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
const health = require("/opt/forchi/src/scheduler/health.js");
(async () => {
  // 1) VPS health BEFORE (qwen should be down)
  let h = await vps.getVpsHealth();
  console.log("BEFORE_QRUN_STOP services:", JSON.stringify(h.services), "qwenPort:", h.qwenPort);

  // 2) Run the FULL workflow repair (jobs/social/video + vps services)
  const actions = await health.repairWorkflows({ notify: () => {} });
  console.log("REPAIR_ACTIONS:");
  actions.forEach((a) => console.log("  -", a));

  // 3) VPS health AFTER repair
  await new Promise((r) => setTimeout(r, 4000));
  h = await vps.getVpsHealth();
  console.log("AFTER_REPAIR services:", JSON.stringify(h.services), "qwenPort:", h.qwenPort);
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
    with sftp.open("/tmp/selftest.js", "w") as f:
        f.write(TEST)
    sftp.close()
    # Introduce a REAL issue: stop the qwen service first.
    i, o, e = c.exec_command("systemctl stop qwen; sleep 1; echo QWEN_NOW=$(systemctl is-active qwen)", timeout=40)
    o.channel.settimeout(30)
    print(o.read().decode(errors="replace"))
    # Now run the self-heal test.
    i2, o2, e2 = c.exec_command("cd /opt/forchi && timeout 90 node /tmp/selftest.js", timeout=120)
    o2.channel.settimeout(110)
    try:
        print(o2.read().decode(errors="replace"))
        err = e2.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:800])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
