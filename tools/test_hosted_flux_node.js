// Test KingNish/Realtime-FLUX with the bot's Node full-fetch + regex approach.
const BASE = "https://kingnish-realtime-flux.hf.space";
const prompt = process.argv[2] || "a lone figure walking through rain at night, high-end anime art, lo-fi digital illustration, manga-style painting, soft atmospheric detail";

(async () => {
  const startRes = await fetch(`${BASE}/gradio_api/call/generate_image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [prompt, 42, 1024, 1024] }),
  });
  console.log("POST:", startRes.status);
  const startData = await startRes.json();
  const eventId = startData.event_id;
  console.log("event_id:", eventId);

  const t0 = Date.now();
  const sseRes = await fetch(`${BASE}/gradio_api/call/generate_image/${eventId}`);
  console.log("SSE status:", sseRes.status);
  const text = await sseRes.text();
  console.log("SSE len:", text.length, "time:", ((Date.now() - t0) / 1000).toFixed(1) + "s");

  const urlMatches = [...text.matchAll(/"url"\s*:\s*"(https?:[^"\\]+)"/g)].map((m) => m[1].replace(/\\u0026/g, "&"));
  const imageUrl = urlMatches.find((u) => u.includes("/file=")) || urlMatches[urlMatches.length - 1];
  console.log("found url:", imageUrl ? imageUrl.slice(0, 80) : "NONE");
  if (!imageUrl) { console.log("SSE head:", text.slice(0, 300)); process.exit(1); }

  const imgRes = await fetch(imageUrl);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  require("fs").writeFileSync("temp_media/hosted_flux_node.png", buf);
  console.log(`Image: ${buf.length} bytes, PNG=${isPng}`);
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
