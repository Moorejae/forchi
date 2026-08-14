// Prints a copy-paste-ready KEY=value block for the env vars Render needs.
// Run: node tools/render_env_helper.js
// Then in Render dashboard -> forchi service -> Environment tab:
//   paste each line's VALUE next to its KEY (or paste whole block if your UI allows bulk).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "GEMINI_KEYS",
  "HF_TOKEN",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "LINKEDIN_ACCESS_TOKEN",
  "LINKEDIN_AUTHOR_URN",
  "GROQ_API_KEY",
  "SERPER_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "TAVILY_API_KEY",
];

// .env stores the HF token under HF_ACCESS_TOKEN; code reads either. Map it over.
const SRC_ALIAS = { HF_TOKEN: "HF_ACCESS_TOKEN" };

console.log("=== ForChi Render env helper ===");
console.log("Copy each VALUE below into Render's Environment tab.");
console.log("(Values are read from your local .env - nothing is modified.)\n");

let missing = [];
for (const key of REQUIRED) {
  const src = SRC_ALIAS[key] || key;
  const val = (process.env[src] || "").trim();
  if (!val) {
    missing.push(key);
    console.log(`${key}=<MISSING in .env>`);
  } else {
    console.log(`${key}=${val}`);
  }
}

console.log("\n=== Summary ===");
if (missing.length) {
  console.log(`MISSING from .env: ${missing.join(", ")}`);
} else {
  console.log("All 12 values found. Paste them into Render and Save, then it will redeploy.");
}
