// Persisted on/off state for the constant-auto JOBS workflow.
// Unlike the social scheduler, this workflow has NO manual apply trigger —
// it runs on constant auto. The only controls are an emergency stop/start.
const fs = require("fs");
const path = require("path");

function dataDir() {
  const dbPath = process.env.JOBS_DB_PATH || process.env.DATABASE_PATH;
  if (dbPath) return path.dirname(path.resolve(dbPath));
  return path.resolve(process.cwd(), "data");
}

const STATE_FILE = path.join(dataDir(), "jobs_mode.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Default ON (constant auto) unless JOBS_MODE_DEFAULT=false.
function isEnabled() {
  const saved = readState();
  if (typeof saved.enabled === "boolean") return saved.enabled;
  return (process.env.JOBS_MODE_DEFAULT || "true").toLowerCase() !== "false";
}

function setEnabled(value) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: !!value, updatedAt: new Date().toISOString() }));
  } catch (err) {
    console.warn("[JobsMode] Could not persist state (ephemeral disk?):", err.message);
  }
}

module.exports = { isEnabled, setEnabled, STATE_FILE };
