/**
 * tools/send_tg.js
 * High-performance Telegram message sender using Node.js native fetch engine.
 * Accepts a single JSON payload string via process.argv[2] for safe multi-line text delivery.
 * Tries direct https://api.telegram.org first, falling back to Cloudflare proxy if needed.
 */

const payloadRaw = process.argv[2];
if (!payloadRaw) {
  console.error("No JSON payload provided");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(payloadRaw);
} catch (e) {
  console.error("Invalid JSON payload:", e.message);
  process.exit(1);
}

const { url, chatId, text } = payload;

// Primary target: direct api.telegram.org; Backup target: Cloudflare proxy
const directUrl = url.includes("workers.dev")
  ? url.replace(/https:\/\/[^\/]+/, "https://api.telegram.org")
  : url;

const proxyUrl = url.includes("workers.dev")
  ? url
  : url.replace("https://api.telegram.org", "https://forchi-tg-proxy.yonkkalu.workers.dev");

async function postMsg(targetUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({
        chat_id: isNaN(chatId) ? chatId : Number(chatId),
        text: text
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function main() {
  try {
    const data = await postMsg(directUrl);
    console.log(JSON.stringify(data));
  } catch (err1) {
    try {
      const data = await postMsg(proxyUrl);
      console.log(JSON.stringify(data));
    } catch (err2) {
      console.error("Outbound delivery failed:", err2.message);
      process.exit(1);
    }
  }
}

main();
