// Detects auto-mode toggle commands like:
//   "turn on auto mode" / "switch off auto mode"
// Only triggers when ONE LINE contains BOTH the action phrase (turn/switch + on/off)
// AND the "auto mode" trigger — all required properties in a single line.
const ACTION_RE = /\b(turn|switch)\s+(on|off)\b/i;
const TRIGGER_RE = /\bauto[\s-]*mode\b/i;

/**
 * @param {string} text
 * @returns {{ enabled: boolean } | null}  enabled=true means ON, false means OFF.
 */
function detectAutoModeToggle(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const action = line.match(ACTION_RE);
    if (action && TRIGGER_RE.test(line)) {
      return { enabled: action[2].toLowerCase() === "on" };
    }
  }
  return null;
}

module.exports = { detectAutoModeToggle };
