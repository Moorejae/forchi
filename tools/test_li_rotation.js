// Simulate the topic rotation over 7 days x 2 slots to confirm variety.
const { FB_THEMES, LI_JOB_TOPICS, LI_PROJECT_TOPICS, pick } = (() => {
  const fs = require("fs");
  const src = fs.readFileSync("src/scheduler/jobs.js", "utf8");
  const fbMatch = src.match(/const FB_THEMES = (\[[\s\S]*?\]);/);
  const jobMatch = src.match(/const LI_JOB_TOPICS = (\[[\s\S]*?\]);/);
  const projMatch = src.match(/const LI_PROJECT_TOPICS = (\[[\s\S]*?\]);/);
  const FB_THEMES = eval(fbMatch[1]);
  const LI_JOB_TOPICS = eval(jobMatch[1]);
  const LI_PROJECT_TOPICS = eval(projMatch[1]);
  const pick = (arr, seed) => arr[seed % arr.length];
  return { FB_THEMES, LI_JOB_TOPICS, LI_PROJECT_TOPICS, pick };
})();

console.log("FB themes:", FB_THEMES.length, "| LI job topics:", LI_JOB_TOPICS.length, "| LI project topics:", LI_PROJECT_TOPICS.length);
console.log("\nDay-by-day LinkedIn topics (2 slots/day: 08:00 job · 16:00 project):");
for (let day = 0; day < 7; day++) {
  const daySeed = day;
  const job = pick(LI_JOB_TOPICS, daySeed * 2 + 1);
  const proj = pick(LI_PROJECT_TOPICS, daySeed * 2 + 2);
  console.log(`Day ${day + 1}: 08:00 "${job.slice(0, 48)}"`);
  console.log(`         16:00 "${proj.slice(0, 48)}"`);
}
