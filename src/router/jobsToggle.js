// Detects job-workflow toggle commands ForChi can trigger by voice/text, e.g.:
//   "turn off the job workflow" / "turn on the job scanner"
//   "activate the job workflow" / "deactivate the job scanner"
//   "disable the job workflow" / "enable the job scanner"
// Matches when ONE line contains an action AND the "job workflow/scanner" trigger.
const TURN_RE = /\b(turn|switch)\s+(on|off)\b/i;
const STATE_RE = /\b(activate|enable|deactivate|disable)\b/i;
const TRIGGER_RE = /\b(job|jobs)[\s-]*(workflow|scanner|agent|hunt|hunting)\b/i;

/**
 * @param {string} text
 * @returns {{ enabled: boolean } | null}  enabled=true means ON, false means OFF.
 */
function detectJobsToggle(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    if (!TRIGGER_RE.test(line)) continue;
    const turn = line.match(TURN_RE);
    if (turn) return { enabled: turn[2].toLowerCase() === "on" };
    const state = line.match(STATE_RE);
    if (state) {
      const w = state[1].toLowerCase();
      if (w === "activate" || w === "enable") return { enabled: true };
      if (w === "deactivate" || w === "disable") return { enabled: false };
    }
  }
  return null;
}

module.exports = { detectJobsToggle };
