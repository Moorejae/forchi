// Safe test of the auto-mode content generators against the live LLM chain.
// Does NOT post anywhere — just validates FB/LinkedIn content generation.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateFacebookPost, generateLinkedInPost } = require("../src/llm/contentGen");

(async () => {
  console.log("=== Facebook post (Victor's style) ===");
  try {
    const fb = await generateFacebookPost("patience and hard work");
    console.log(JSON.stringify(fb, null, 2).slice(0, 1200));
  } catch (e) {
    console.log("FB ERROR:", e.message);
  }

  console.log("\n=== LinkedIn post (tech/AI) ===");
  try {
    const li = await generateLinkedInPost("a daily AI hack for developers");
    console.log(JSON.stringify(li, null, 2).slice(0, 1200));
  } catch (e) {
    console.log("LI ERROR:", e.message);
  }
  process.exit(0);
})();
