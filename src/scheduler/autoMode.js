// Persisted on/off state for the auto-posting scheduler.
// Defaults to ON. The user can toggle it from Telegram with
// "turn on auto mode" / "switch off auto mode".
const fs = require("fs");
const path = require("path");

// Resolve the data directory (same folder as the SQLite DB).
function dataDir() {
  const dbPath = process.env.DATABASE_PATH;
  if (dbPath) return path.dirname(path.resolve(dbPath));
  return path.resolve(process.cwd(), "data");
}

const STATE_FILE = path.join(dataDir(), "auto_mode.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Default enabled unless AUTO_MODE_DEFAULT=false is set, or a saved state exists.
function isEnabled() {
  const saved = readState();
  if (typeof saved.enabled === "boolean") return saved.enabled;
  return (process.env.AUTO_MODE_DEFAULT || "true").toLowerCase() !== "false";
}

function setEnabled(value) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: !!value, updatedAt: new Date().toISOString() }));
  } catch (err) {
    console.warn("[AutoMode] Could not persist state (ephemeral disk?):", err.message);
  }
}

module.exports = { isEnabled, setEnabled, STATE_FILE };
