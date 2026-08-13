// Debug: dump raw SSE text from the hosted SDXL-Lightning predict endpoint.
const BASE = "https://radames-real-time-text-to-image-sdxl-lightning.hf.space";

(async () => {
  const startRes = await fetch(`${BASE}/gradio_api/call/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: ["test image, anime style", 0.0, 0] }),
  });
  const { event_id: eventId } = await startRes.json();
  console.log("event_id:", eventId);

  const sseRes = await fetch(`${BASE}/gradio_api/call/predict/${eventId}`);
  const text = await sseRes.text();
  console.log("SSE length:", text.length);
  console.log("=== RAW SSE (first 3000 chars) ===");
  console.log(text.slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
