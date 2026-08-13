require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { searchTavily, searchSerper, searchExa, searchFirecrawl } = require("../src/llm/webSearch");

(async () => {
  const q = "latest AI news 2026";
  const tests = [
    ["Tavily", searchTavily, process.env.TAVILY_API_KEY],
    ["Serper", searchSerper, process.env.SERPER_API_KEY],
    ["Exa", searchExa, process.env.EXA_API_KEY],
    ["Firecrawl", searchFirecrawl, process.env.FIRECRAWL_API_KEY],
  ];
  for (const [name, fn, key] of tests) {
    try {
      const r = await fn(q, key);
      console.log(`[${name}] OK -> ${r.slice(0, 100).replace(/\n/g, " ")}`);
    } catch (e) {
      console.log(`[${name}] FAIL -> ${e.message}`);
    }
  }
  process.exit(0);
})();
