require("dotenv").config();

async function testAllGeminiKeys() {
  const keys = (process.env.GEMINI_KEYS || process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  console.log(`Testing ${keys.length} Gemini API keys...`);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] })
      });
      if (res.ok) {
        console.log(`Key #${i + 1} (${key.substring(0, 8)}...): ✅ VALID (HTTP 200)`);
      } else {
        console.log(`Key #${i + 1} (${key.substring(0, 8)}...): ❌ ERROR (HTTP ${res.status})`);
      }
    } catch (err) {
      console.log(`Key #${i + 1} (${key.substring(0, 8)}...): ❌ FETCH ERROR (${err.message})`);
    }
  }
}

testAllGeminiKeys();
