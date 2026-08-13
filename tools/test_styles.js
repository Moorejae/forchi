require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateLinkedInPost, generateFacebookPost } = require("../src/llm/contentGen");

(async () => {
  console.log("=== LinkedIn (in-depth + hashtags) ===");
  const li = await generateLinkedInPost("the latest AI news and what it means for how we work");
  console.log("postText:\n" + li.postText);
  console.log("\nvisualTopic:", li.visualTopic);
  console.log("\nHas hashtags:", /#[A-Za-z]/.test(li.postText));

  console.log("\n=== Facebook (signature enforced) ===");
  const fb = await generateFacebookPost("life, love, self-worth, and human nature");
  console.log("Ends with 'Fickle youth':", fb.postText.trim().toLowerCase().endsWith("fickle youth"));
  console.log("Has hashtags (should be false):", /#[A-Za-z]/.test(fb.postText));
  console.log("Last 40 chars:", JSON.stringify(fb.postText.slice(-40)));
  process.exit(0);
})();
