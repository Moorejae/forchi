// Layer 1: Deterministic regex gate tripwire (Blueprint Section 2)
// Only messages containing an explicit "make a post" phrase reach Layer 2.
// Everything else goes straight to chat Q&A — no LLM extraction call at all.
// Kept deliberately narrow on purpose. It's a tripwire, not a classifier.

const POST_TRIGGER = /\bmake\s+a\s+post\b/i;

function passesGate(message) {
  if (!message || typeof message !== "string") return false;
  return POST_TRIGGER.test(message);
}

module.exports = { passesGate };
