require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateFacebookPost } = require("../src/llm/contentGen");

(async () => {
  const themes = ["life, love, self-worth, and human nature", "marriage and sacrifice", "gratitude and faith through hard times"];
  for (const t of themes) {
    try {
      const r = await generateFacebookPost(t);
      const first = r.postText.split("\n")[0].slice(0, 80);
      const lower = r.postText.trim().toLowerCase();
      const hasSig = lower.includes("fickle youth");
      const hasTags = /#\w+/.test(r.postText);
      console.log(`THEME: ${t.slice(0, 40)}...`);
      console.log(`  opens: "${first}"`);
      console.log(`  has Fickle youth: ${hasSig} | has hashtags: ${hasTags}`);
      console.log("");
    } catch (e) {
      console.log(`ERR: ${e.message}`);
    }
  }
  process.exit(0);
})();
