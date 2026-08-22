// src/scheduler/vps.js
// REAL VPS-level health + repair for ForChi (runs on the Contabo VPS as root).
// - Checks the actual systemd services (forchi / qwen / v61-bot), the local
//   Qwen LLM port, and disk.
// - repairVps() actually restarts a down service instead of just reporting it.
// This is what makes ForChi able to FIX real issues across ALL workflows, not
// only re-register its in-process schedulers.
const { execFile } = require("child_process");

// Run a shell command; never rejects — returns stdout (trimmed) or "" on error.
function run(cmd, timeoutMs = 12000) {
  return new Promise((resolve) => {
    execFile("bash", ["-c", cmd], { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve(String(stdout || "").trim());
    });
  });
}

async function svcActive(name) {
  return (await run(`systemctl is-active ${name}`)) === "active";
}

// Real snapshot of the VPS services ForChi depends on.
async function getVpsHealth() {
  const out = { services: {}, qwenPort: false, disk: "" };
  try {
    out.services.forchi = await svcActive("forchi");
    out.services.qwen = await svcActive("qwen");
    out.services.v61bot = await svcActive("v61-bot");
    const port = await run("ss -ltn 2>/dev/null | grep -c 8080");
    const n = Number(port);
    out.qwenPort = Number.isFinite(n) && n >= 1;
    out.disk = await run("df -h / | tail -1");
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// REAL fixes: restart a down service. Returns a list of human actions taken.
async function repairVps() {
  const actions = [];
  try {
    const h = await getVpsHealth();
    if (h.services && h.services.qwen === false) {
      await run("systemctl restart qwen");
      actions.push("local Qwen LLM service was DOWN → restarted (model reloading)");
    } else {
      actions.push(`local Qwen LLM ${h.qwenPort ? "up (port 8080)" : "service up"}`);
    }
    if (h.services && h.services.v61bot === false) {
      await run("systemctl restart v61-bot");
      actions.push("v61 prediction bot was DOWN → restarted");
    } else {
      actions.push("v61 prediction bot up");
    }
  } catch (e) {
    actions.push(`VPS repair error: ${e.message}`);
  }
  return actions;
}

module.exports = { getVpsHealth, repairVps, svcActive, run };
