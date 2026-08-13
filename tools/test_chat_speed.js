// Verifies the chat path now prefers Gemini (fast) with Qwen as fallback.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { callGemmaForChat } = require("../src/llm/provider");

(async () => {
  const t0 = Date.now();
  const reply = await callGemmaForChat("Say hello in one short sentence.");
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nChat reply in ${secs}s:`);
  console.log(reply);
  process.exit(0);
})();
