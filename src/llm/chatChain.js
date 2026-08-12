// Blueprint Section 3b: Chat uses Gemma directly — skips the Gemini waterfall.
// Chat is the highest-volume path; no rate-limit bookkeeping needed here.
// Rotating system-prompt framings + temperature 0.7-0.9 to avoid repetitive phrasing.

const { callGemmaForChat } = require("./provider");

const CHAT_FRAMINGS = [
  "Answer naturally and conversationally, like a knowledgeable friend. Your name is ForChi.",
  "Give your honest take, feel free to offer a different angle than you might have last time. Your name is ForChi.",
  "Respond plainly and directly — vary your wording, don't repeat stock phrasing. Your name is ForChi.",
  "Be warm, sharp, and genuine. Speak like a trusted colleague, not a chatbot. Your name is ForChi.",
];

async function chatReply(message) {
  const framing = CHAT_FRAMINGS[Math.floor(Math.random() * CHAT_FRAMINGS.length)];
  const prompt = `${framing}\n\nUser: ${message}`;
  return await callGemmaForChat(prompt);
}

module.exports = { chatReply, CHAT_FRAMINGS };
