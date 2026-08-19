// Detects plain-chat requests for ForChi to RUN DIAGNOSTICS or REPAIR the
// workflows (job + social), so the user can ask in natural language instead of
// only via /diag and /fix. Examples:
//   "run diagnostics" / "is everything ok?" / "what's wrong?" / "why did it stop?"
//   "fix the workflows" / "repair the workflows" / "fix the job workflow"
const DIAG_RE = /\b(diagnostic|diagnostics|health check|what'?s wrong|what went wrong|is everything (ok|okay|fine)|why (did|does).*(stop|fail|break)|check (the )?(workflows?|systems?|status))\b/i;
const REPAIR_RE = /\b(fix|repair|restore|recover|restart)\b.*\b(workflows?|auto mode|posting|schedulers?|job agent|bot)\b/i;

function detectDiagRequest(text) {
  const t = String(text || "").trim();
  if (t.length < 5) return false;
  if (/^\/diag\b/.test(t)) return true; // /diag handled by command handler; harmless duplicate
  return DIAG_RE.test(t);
}

function detectRepairRequest(text) {
  const t = String(text || "").trim();
  if (t.length < 5) return false;
  if (/^\/fix\b/.test(t)) return true;
  // A repair request must be an ACTION (fix/repair/restart...), not a question.
  return REPAIR_RE.test(t) && !/\?$/.test(t.trim());
}

module.exports = { detectDiagRequest, detectRepairRequest };
