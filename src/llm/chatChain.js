// Blueprint Section 3b: Chat uses Gemma directly — skips the Gemini waterfall.
// Chat is the highest-volume path; no rate-limit bookkeeping needed here.
// Rotating system-prompt framings + temperature 0.7-0.9 to avoid repetitive phrasing.

const { callGemmaForChat } = require("./provider");
const { searchWeb, looksLikeSearchQuery } = require("./webSearch");

const CHAT_FRAMINGS = [
  "Answer naturally and conversationally, like a knowledgeable friend. Your name is ForChi.",
  "Give your honest take, feel free to offer a different angle than you might have last time. Your name is ForChi.",
  "Respond plainly and directly — vary your wording, don't repeat stock phrasing. Your name is ForChi.",
  "Be warm, sharp, and genuine. Speak like a trusted colleague, not a chatbot. Your name is ForChi.",
];

async function chatReply(message) {
  const framing = CHAT_FRAMINGS[Math.floor(Math.random() * CHAT_FRAMINGS.length)];
  let prompt = `${framing}\n\nUser: ${message}`;

  // Web grounding: for likely current/factual questions, search the web and give
  // the LLM real, up-to-date context so it never answers from stale training data.
  if (looksLikeSearchQuery(message)) {
    try {
      console.log(`[Chat Search] Searching web for: "${message.slice(0, 80)}"`);
      const web = await searchWeb(message);
      if (web && web.results) {
        prompt +=
          `\n\n[WEB SEARCH RESULTS (from ${web.provider}) — use these for accurate, up-to-date facts ` +
          `when they answer the user's question. Do NOT mention the search or these results directly; ` +
          `just give a natural, helpful answer grounded in them. If they don't answer it, say so and answer from knowledge:]\n` +
          web.results;
      }
    } catch (err) {
      console.warn("[Chat Search] failed:", err.message);
    }
  }

  return await callGemmaForChat(prompt);
}

module.exports = { chatReply, CHAT_FRAMINGS };
