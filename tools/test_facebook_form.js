// Verifies the Facebook multipart fix: native FormData produces a proper
// multipart/form-data request with a boundary (the old npm form-data did not),
// and detectImageMime reads PNG/JPEG magic bytes correctly.
const http = require("http");
const { detectImageMime } = require("../src/workflows/social/imageMime");

// --- 1. detectImageMime ---
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
console.log("PNG  ->", JSON.stringify(detectImageMime(png)));
console.log("JPEG ->", JSON.stringify(detectImageMime(jpg)));
console.log("tiny ->", JSON.stringify(detectImageMime(Buffer.from([1]))));

// --- 2. Native FormData boundary (mirrors facebook.js exactly) ---
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    console.log("\nContent-Type header received:", req.headers["content-type"]);
    console.log("Has multipart boundary:", /^multipart\/form-data; boundary=/.test(req.headers["content-type"] || ""));
    console.log("Has source field:", body.includes('name="source"'));
    console.log("Has access_token field:", body.includes("name=\"access_token\""));
    res.end("ok");
    server.close();
  });
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const imageBuffer = png;
  const form = new FormData();
  form.append("source", new Blob([imageBuffer], { type: "image/png" }), "post.png");
  form.append("caption", "test caption");
  form.append("published", "false");
  form.append("access_token", "FAKE_TOKEN");

  const r = await fetch(`http://127.0.0.1:${port}`, { method: "POST", body: form });
  console.log("Fetch status:", r.status);
  process.exit(0);
});
