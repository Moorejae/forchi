// End-to-end test of the REAL processVoiceMessage (download -> direct Gemini OGG).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { processVoiceMessage } = require("../src/voice/transcriber");

const ogg = path.join(os.tmpdir(), "sample.ogg");
if (!fs.existsSync(ogg)) {
  console.log("sample.ogg missing — run test_gemini_ogg.js first");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "audio/ogg" });
  fs.createReadStream(ogg).pipe(res);
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  console.log("Serving sample.ogg on :" + port);
  const t0 = Date.now();
  try {
    const transcript = await processVoiceMessage(`http://127.0.0.1:${port}/sample.ogg`, "ogg");
    console.log(`\n✅ processVoiceMessage returned in ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
    console.log(JSON.stringify(transcript));
  } catch (err) {
    console.log("\n❌ processVoiceMessage FAILED:", err.message);
  } finally {
    server.close();
    process.exit(0);
  }
});
