// Unit tests for the auto-mode toggle command + persisted state.
process.env.DATABASE_PATH = require("path").join(__dirname, "..", "temp_media", "test.db");
const { detectAutoModeToggle } = require("../src/router/autoModeToggle");
const autoMode = require("../src/scheduler/autoMode");
const fs = require("fs");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log("  ✅", name); }
  else { fail++; console.log("  ❌", name, "-> got", JSON.stringify(actual), "expected", JSON.stringify(expected)); }
}

console.log("== detectAutoModeToggle ==");
check("turn on auto mode", detectAutoModeToggle("turn on auto mode"), { enabled: true });
check("switch off auto mode", detectAutoModeToggle("switch off auto mode"), { enabled: false });
check("Switch ON auto-mode", detectAutoModeToggle("Switch ON auto-mode"), { enabled: true });
check("please turn off auto mode now", detectAutoModeToggle("please turn off auto mode now"), { enabled: false });
check("turn auto mode on", detectAutoModeToggle("turn auto mode on"), null); // action not adjacent to on/off
check("turn off autopilot", detectAutoModeToggle("turn off autopilot"), null); // no auto mode trigger
check("auto mode is cool", detectAutoModeToggle("auto mode is cool"), null); // no action
check("just turn on the lights", detectAutoModeToggle("just turn on the lights"), null); // no auto mode
check("multi\nline\nswitch off auto mode", detectAutoModeToggle("multi\nline\nswitch off auto mode"), { enabled: false }); // second line
check("turn on auto mode\nand also make a post", detectAutoModeToggle("turn on auto mode\nand also make a post"), { enabled: true });
check("empty", detectAutoModeToggle(""), null);
check("TURN ON AUTO MODE (caps)", detectAutoModeToggle("TURN ON AUTO MODE"), { enabled: true });

console.log("== autoMode persistence ==");
// default ON
autoMode.setEnabled(true);
check("default on", autoMode.isEnabled(), true);
autoMode.setEnabled(false);
check("toggled off", autoMode.isEnabled(), false);
autoMode.setEnabled(true);
check("toggled back on", autoMode.isEnabled(), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
