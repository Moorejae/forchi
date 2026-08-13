// Replicates src/workflows/social/index.js generateZeroGPUImage exactly, against the live Space
const base = (process.env.ZEROGPU_ENDPOINT || "https://slymun-forchi-img.hf.space").trim().replace(/\/+$/, "");

async function generateZeroGPUImage(prompt) {
  console.log(`[Image API] Generating image via ZeroGPU: "${prompt}"...`);
  const startRes = await fetch(`${base}/gradio_api/call/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [prompt] }),
  });
  if (!startRes.ok) throw new Error(`ZeroGPU start failed: HTTP ${startRes.status}`);
  const startData = await startRes.json();
  const eventId = startData.event_id;
  if (!eventId) throw new Error("ZeroGPU: no event_id in response");

  const sseRes = await fetch(`${base}/gradio_api/call/generate/${eventId}`);
  if (!sseRes.ok) throw new Error(`ZeroGPU SSE failed: HTTP ${sseRes.status}`);
  const text = await sseRes.text();

  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  if (!imageUrl) throw new Error("ZeroGPU: could not find image URL in response");

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`ZeroGPU: image download failed HTTP ${imgRes.status}`);
  const buf = await imgRes.arrayBuffer();
  return Buffer.from(buf);
}

(async () => {
  const buf = await generateZeroGPUImage("A quiet sunrise over a misty lake, oil painting style, rich brushstrokes");
  console.log("Received buffer bytes:", buf.length);
  // Detect format: PNG magic = 89 50 4E 47
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  console.log("Is PNG:", isPng);
  require("fs").writeFileSync("temp_media/bot_zerogpu_test.png", buf);
  console.log("Saved to temp_media/bot_zerogpu_test.png");
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
