// Generate FB + LI style images using the bot's real prompts + hosted FLUX (auth).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { buildImagePrompt, generateImageWithFallback, normalizeImage } = require("../src/workflows/social/index");
const fs = require("fs");

const TOPICS = {
  facebook: "a lone figure standing before an endless melancholic sky",
  linkedin: "a futuristic biomechanical mecha warrior",
};

(async () => {
  for (const [key, topic] of Object.entries(TOPICS)) {
    const prompt = buildImagePrompt(topic, key);
    console.log(`\n=== ${key} ===`);
    console.log("prompt:", prompt.slice(0, 120), "...");
    try {
      const raw = await generateImageWithFallback(prompt);
      const norm = await normalizeImage(raw);
      const out = `temp_media/ref_${key}.jpg`;
      fs.writeFileSync(out, norm);
      console.log(`saved -> ${out} (${norm.length} bytes)`);
    } catch (e) {
      console.log("FAIL:", e.message);
    }
  }
  process.exit(0);
})();
