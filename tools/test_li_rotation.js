// Simulate the topic rotation over 7 days x 5 slots to confirm variety.
const { FB_THEMES, LI_TOPICS, pick } = (() => {
  // mirror the scheduler's arrays/logic for the sim
  const cron = require("node-cron");
  const socialWorkflow = {};
  const autoMode = { isEnabled: () => true };
  const jobs = require("../src/scheduler/jobs");
  // jobs only exports initScheduler; re-parse the arrays via reading the file is overkill.
  // Instead just eval the arrays from the source:
  const fs = require("fs");
  const src = fs.readFileSync("src/scheduler/jobs.js", "utf8");
  const fbMatch = src.match(/const FB_THEMES = (\[[\s\S]*?\]);/);
  const liMatch = src.match(/const LI_TOPICS = (\[[\s\S]*?\]);/);
  const FB_THEMES = eval(fbMatch[1]);
  const LI_TOPICS = eval(liMatch[1]);
  const pick = (arr, seed) => arr[seed % arr.length];
  return { FB_THEMES, LI_TOPICS, pick };
})();

console.log("FB themes:", FB_THEMES.length, "| LI topics:", LI_TOPICS.length);
console.log("\nDay-by-day LinkedIn topics (5 slots/day):");
for (let day = 0; day < 7; day++) {
  const daySeed = day; // pretend epoch day
  const picked = [];
  for (const h of [0, 8, 12, 16, 20]) {
    picked.push(pick(LI_TOPICS, daySeed * 29 + Math.floor(h / 4) + 1));
  }
  const unique = new Set(picked).size;
  console.log(`Day ${day + 1}: ${unique}/5 unique | ${picked.map((t) => t.slice(0, 38)).join(" | ")}`);
}
