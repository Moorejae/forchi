require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { searchWeb } = require("../src/llm/webSearch");

(async () => {
  console.log("=== searchWeb test ===");
  const t0 = Date.now();
  const result = await searchWeb("what is anthropic's latest Claude model 2026");
  console.log(`\nTook ${((Date.now() - t0) / 1000).toFixed(1)}s | provider: ${result ? result.provider : "NONE"}`);
  if (result) {
    console.log("\n--- results ---");
    console.log(result.results.slice(0, 1200));
  }
  process.exit(0);
})();
