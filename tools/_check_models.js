// Temp: list generateContent-capable models visible to the first AQ key + limits.
require("dotenv").config();
const fs = require("fs");

(async () => {
  const env = fs.readFileSync(".env", "utf8");
  const m = env.match(/^GEMINI_KEYS=(.+)$/m);
  const keys = (m ? m[1] : "").split(",").map((k) => k.trim()).filter((k) => k.startsWith("AQ."));
  console.log("AQ keys:", keys.length, "| using:", keys[0].slice(0, 14) + "...");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${keys[0]}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) { console.log("HTTP", res.status, (await res.text()).slice(0, 300)); process.exit(1); }
  const d = await res.json();

  const names = (d.models || [])
    .filter((x) => (x.supportedGenerationMethods || []).includes("generateContent"))
    .map((x) => x.name.replace("models/", ""))
    .sort();
  console.log("generateContent models:", names.length);

  // Show any gemini-3.7 / gemma-4 / flash / pro / 3.6 / 3.5 flash variants + limits
  const want = names.filter((n) => /gemini-3\.7|gemma-4|gemma-3-27|flash-lite|3\.6-flash|3\.5-flash/.test(n));
  console.log("\n=== relevant models + token limits ===");
  for (const n of want) {
    const mm = (d.models || []).find((x) => x.name === `models/${n}`);
    const lim = mm && mm.inputTokenLimit;
    const out = mm && mm.outputTokenLimit;
    console.log(`${n}  (in=${lim} out=${out})`);
  }

  console.log("\n=== all gemini-* names ===");
  for (const n of names.filter((x) => x.startsWith("gemini"))) console.log(" ", n);
  console.log("\n=== all gemma-* names ===");
  for (const n of names.filter((x) => x.startsWith("gemma"))) console.log(" ", n);
})();
