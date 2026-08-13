// Test the bot's real functions now that auth headers are wired in.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateHostedImage, generateZeroGPUImage } = require("../src/workflows/social/index");

(async () => {
  const prompt = "ethereal dreamy cinematic digital painting, warm golden light, Lucas Alighieri style, painterly, ultra detailed";

  console.log("=== generateHostedImage (radames, authenticated) ===");
  try {
    const buf = await generateHostedImage(prompt);
    console.log("bytes:", buf.length, "png:", buf[0] === 0x89 && buf[1] === 0x50);
  } catch (e) {
    console.log("FAIL:", e.message);
  }

  console.log("\n=== generateZeroGPUImage (our fp8 FLUX Space, authenticated) ===");
  try {
    const buf = await generateZeroGPUImage(prompt);
    console.log("bytes:", buf.length, "png:", buf[0] === 0x89 && buf[1] === 0x50);
  } catch (e) {
    console.log("FAIL:", e.message);
  }
  process.exit(0);
})();
