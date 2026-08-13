require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { chatReply } = require("../src/llm/chatChain");

(async () => {
  const t0 = Date.now();
  console.log("Q: what was anthropic's latest model?\n");
  const reply = await chatReply("what was anthropic's latest model?");
  console.log("A:", reply);
  console.log(`\n(answered in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(0);
})();
