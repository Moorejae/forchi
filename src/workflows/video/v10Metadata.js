// ForChi V10 long-form metadata — title (3 thematic hashtags, NO #shorts) and a
// description with TIMESTAMP CHAPTERS + 3 hashtags (per the automated daily spec).
const CRYPTO = require("crypto");

// Thematic hashtag pools for long-form educational/history videos (safe, on-brand).
// buildV10Title picks 3 (one per pool) so the title always has exactly 3 hashtags.
const TAG_POOLS = [
  ["history", "psychology", "wisdom", "moralstories", "humanbehavior", "lifelessons", "biblestories", "storytelling"],
  ["education", "documentary", "mindset", "philosophy", "truehistory", "learning", "ancienthistory", "humannature"],
  ["moralstory", "deepthoughts", "character", "selfimprovement", "wisdomstory", "familyfriendly", "timelesslessons", "everydaywisdom"],
];

function makeRng(seed) {
  let s = seed == null ? CRYPTO.randomBytes(4).readUInt32BE(0) : seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function pickTag(rng, pool, used) {
  const c = pool.filter((t) => !used.includes(t));
  return c[Math.floor(rng() * c.length)];
}

// format seconds -> "M:SS" (chapters style)
function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

// Convert a cumulative timeline [{label, startSec, endSec}] into chapter lines,
// skipping zero-length segments. Returns ["0:00 Intro", "1:23 The Trap", ...]
function buildChapters(timeline) {
  const out = [];
  for (const seg of timeline || []) {
    const label = (seg.label || "").trim();
    if (!label) continue;
    if (typeof seg.startSec === "number" && typeof seg.endSec === "number" && seg.endSec - seg.startSec < 2) continue;
    out.push(`${formatTime(seg.startSec || 0)} ${label}`);
  }
  return out;
}

// title = "<base> #t1 #t2 #t3"  (exactly 3 hashtags, thematic — NO #shorts)
function buildV10Title(baseTitle, rng, forcedTags) {
  const r = rng || makeRng(null);
  const used = [];
  const pick = (i) => (forcedTags && forcedTags[i] ? forcedTags[i] : pickTag(r, TAG_POOLS[i], used));
  const t1 = pick(0); used.push(t1);
  const t2 = pick(1); used.push(t2);
  const t3 = pick(2);
  return `${baseTitle} #${t1} #${t2} #${t3}`;
}

// ── CURIOSITY-GAP "WHY" TITLES (user directive 2026-08-31) ───────────────────
// Long-form channels win clicks with the curiosity-gap psychology: an open loop
// in the title that the video then closes ("Why ..."). We GUARANTEE every V10
// title opens that loop:
//   1. If the script title is already a curiosity question (Why/How/What/Who/
//      The Real Reason/What Nobody Tells You) -> keep it.
//   2. Otherwise transform it deterministically into a WHY hook (open loop,
//      specific to the story, never clickbait lies).
const CURIOUS_RE = /^(why\b|how\b|what\b|who\b|the real reason|what nobody tells|the truth about|the hidden reason|the surprising reason)/i;
const FALLBACK_REASONS = [
  "Matters More Than You Think",
  "Changes Everything You Knew",
  "Was Hiding in Plain Sight",
  "Is Not What the History Books Say",
  "Explains More Than Any Lesson Ever Could",
];

function capWord(w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }
// Lowercase a leading article when it lands mid-sentence ("Why a Family Secret...").
function deArticle(w) { return /^(a|an|the)\s+/i.test(w) ? w[0].toLowerCase() + w.slice(1) : w; }

function buildV10CuriosityTitle(baseTitle, meta) {
  // Clean: strip hashtags / trailing punctuation / collapse whitespace.
  let t = String(baseTitle || meta?.title || "")
    .replace(/#\w+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/[.!?]+$/, "").trim();
  if (!t) return "Why the Story Nobody Tells Still Matters";
  if (CURIOUS_RE.test(t)) return t;

  // "Book Summary: <subject>" -> keep the label, hook the subject with WHY.
  if (/^book summary\s*[:,-]?\s+/i.test(t)) {
    const rest = t.replace(/^book summary\s*[:,-]?\s+/i, "").trim();
    return `Book Summary: ${buildV10CuriosityTitle(rest, meta)}`;
  }

  // "The <Danger/Cost/Weight> of <X>" -> "Why <X> Is More ... Than You Think"
  const ofMatch = t.match(/^the\s+(.+?)\s+of\s+(.+)$/i);
  if (ofMatch) {
    const subject = deArticle(capWord(ofMatch[2].trim()));
    const aspect = ofMatch[1].trim().toLowerCase();
    const tail = aspect.includes("danger") ? "Is More Dangerous Than It Looks"
      : aspect.includes("cost") ? "Costs More Than Anyone Admits"
      : aspect.includes("weight") || aspect.includes("price") ? "Is Heavier Than You Think"
      : `Reveals More About ${capWord(aspect)} Than You Think`;
    return `Why ${subject} ${tail}`;
  }

  // Generic: "Why <title> <reason>" (open loop, still specific).
  const rng = makeRng(meta?.seed == null ? null : meta.seed);
  const reason = FALLBACK_REASONS[Math.floor(rng() * FALLBACK_REASONS.length)];
  return `Why ${deArticle(capWord(t))} ${reason}`;
}


// Description: title, timestamp chapters, short script excerpt, AI note, 3 hashtags.
// unique hash (vid:xxxxxx) so every post's description differs.
function buildV10Description({ baseTitle, chapters, script, seed }) {
  const r = makeRng(seed == null ? CRYPTO.randomBytes(4).readUInt32BE(0) : seed);
  const chapterBlock = (chapters && chapters.length ? chapters.join("\n") : "");
  const excerpt = (script || baseTitle).trim().slice(0, 180).replace(/\s+/g, " ");
  const uniq = CRYPTO.createHash("md5").update(excerpt + (seed || "") + Date.now()).digest("hex").slice(0, 6);
  const tags = [
    pickTag(r, TAG_POOLS[0], []),
    pickTag(r, TAG_POOLS[1], []),
    pickTag(r, TAG_POOLS[2], []),
  ];
  return [
    baseTitle,
    "",
    "⏱ TIMESTAMPS",
    chapterBlock || "(coming soon)",
    "",
    excerpt + "…",
    "",
    "AI-assisted creation: AI voice + AI-generated illustrations.",
    "",
    `#${tags[0]} #${tags[1]} #${tags[2]}`,
    `vid:${uniq}`,
  ].join("\n");
}

module.exports = { buildV10Title, buildV10Description, buildChapters, formatTime, makeRng, TAG_POOLS, buildV10CuriosityTitle, CURIOUS_RE };
