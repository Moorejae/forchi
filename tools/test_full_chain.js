// Test the full generateImageWithFallback chain (hosted FLUX first) + WebP->JPEG normalize.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { generateImageWithFallback, normalizeImage } = require("../src/workflows/social/index");

(async () => {
  const prompt = "ethereal dreamy cinematic digital painting, warm golden light, Lucas Alighieri style, painterly, ultra detailed";
  const t0 = Date.now();
  try {
    const buf = await generateImageWithFallback(prompt);
    console.log(`\nRaw image in ${((Date.now() - t0) / 1000).toFixed(1)}s | bytes: ${buf.length}`);
    require("fs").writeFileSync("temp_media/raw_webp.bin", buf);
    const norm = await normalizeImage(buf);
    const isJpg = norm[0] === 0xff && norm[1] === 0xd8;
    console.log(`Normalized -> bytes: ${norm.length} | jpg: ${isJpg}`);
    require("fs").writeFileSync("temp_media/final_jpeg.jpg", norm);
    console.log("saved temp_media/final_jpeg.jpg");
  } catch (e) {
    console.log("FAIL:", e.message);
  }
  process.exit(0);
})();
