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
// YouTube caps titles at 100 chars — a long curiosity hook + long tags can exceed
// that and the upload is rejected with HTTP 400 "invalid or empty video title".
// We trim the BASE (never the hashtags) down to a word boundary so the final title
// always fits, keeping the curiosity hook readable.
function buildV10Title(baseTitle, rng, forcedTags) {
  const r = rng || makeRng(null);
  const used = [];
  const pick = (i) => (forcedTags && forcedTags[i] ? forcedTags[i] : pickTag(r, TAG_POOLS[i], used));
  const t1 = pick(0); used.push(t1);
  const t2 = pick(1); used.push(t2);
  const t3 = pick(2);
  const tagsPart = `#${t1} #${t2} #${t3}`;
  const MAX_TITLE = 100;
  let base = String(baseTitle || "").replace(/\s+/g, " ").trim();
  const maxBase = Math.max(15, MAX_TITLE - tagsPart.length - 1);
  if (base.length > maxBase) {
    let cut = base.slice(0, maxBase - 1).trim();
    const sp = cut.lastIndexOf(" ");
    if (sp >= Math.floor(maxBase / 2)) cut = cut.slice(0, sp).trim();
    base = (cut || base.slice(0, maxBase - 1)) + "…";
  }
  const title = `${base} ${tagsPart}`.trim();
  // Final safety net: never exceed 100 chars no matter what the tags contain.
  return title.length <= MAX_TITLE ? title : title.slice(0, MAX_TITLE - 1).trim() + "…";
}

// ── SHORT "MYSTERY" TITLES (user directive 2026-09-09) ───────────────────────
// The old convention forced every title into a long "Why ..." curiosity question
// ("Y." = the Why-prefix). That is DROPPED. New rule:
//   - NO leading Why/How/What/Who/The Real Reason/... question hooks ("stop using Y.").
//   - MAX 4 words for the descriptive name.
//   - SHROUDED IN MYSTERY yet HONEST: it names the story's iconic object/event/
//     person so the viewer knows what the video is about, but the twist/lesson
//     stays hidden — the click opens the loop the video closes.
// v10ScriptGen now asks the model to WRITE this title; this function is the
// deterministic safety net that (a) strips any leaked "Why..."/"Y." question
// opener and (b) forces the result down to <=4 words.
const QUESTION_LEAD = /^(why\b|how\b|what\b|who\b|the real reason|the truth about|what nobody tells|what nobody knows|the hidden reason|the surprising reason|the untold story of|the secret (behind|of)|y\.?\s+)/i;
const MYSTERY_FALLBACKS = [
  "The Story Behind the Silence",
  "What the Past Never Said",
  "The Quiet Fall",
  "The Secret They Buried",
  "The Day Everything Changed",
];

function wordCount(t) { return String(t || "").trim() ? String(t).trim().split(/\s+/).length : 0; }

// Deterministic fallback when a title is not already a short mystery name:
// keep the story's iconic "object of ..." phrase (max 4 words), else the first
// 4 words, dropping a leading a/an/the when it helps fit the 4-word limit.
function mysteryFrom(t) {
  let w = String(t || "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "";
  const i = w.findIndex((x) => /^of$/i.test(x));
  if (i > 0) {
    // "The Cost of Household Secrets..." -> keep "Cost of Household Secrets" (<=4)
    const start = Math.max(0, i - 1);
    let keep = w.slice(start, start + 4);
    if (keep.length === 4 && /^(a|an|the)$/i.test(keep[0])) keep = keep.slice(1);
    w = keep;
  } else {
    w = w.slice(0, 4);
    if (/^(a|an|the)$/i.test(w[0])) w = w.slice(1);
    w = w.slice(0, 4); // after dropping a leading article, still cap at 4 words
  }
  return w.join(" ");
}

function buildV10MysteryTitle(baseTitle, meta) {
  // Clean: strip hashtags / trailing punctuation / collapse whitespace.
  let t = String(baseTitle || meta?.title || "")
    .replace(/#\w+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/[.!?…]+$/, "").trim();

  // "Book Summary: <subject>" is a required playlist label — keep it, but limit
  // the whole name to <=4 words (label = 2 words, subject <= 2 words).
  if (/^book summary\s*[:,-]?\s+/i.test(t)) {
    const rest = t.replace(/^book summary\s*[:,-]?\s+/i, "").trim();
    const subj = mysteryFrom(rest).split(/\s+/).filter(Boolean).slice(0, 2);
    if (/^(of|the|a|an)$/i.test(subj[subj.length - 1] || "")) subj.pop();
    return `Book Summary: ${subj.join(" ")}`;
  }

  // Stop the "Y."/Why... question convention (user directive 2026-09-09).
  t = t.replace(QUESTION_LEAD, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^[,.;:!?–—-]+/, "").trim();
  // Legacy "The Danger of Winning: The True Story of Pyrrhus" style -> keep the
  // iconic phrase before the colon/dash ("Danger of Winning").
  const sep = t.search(/[:—–]/);
  if (sep > 2) t = t.slice(0, sep).replace(/[—–:]+$/, "").trim();
  if (!t) {
    const rng = makeRng(meta?.seed == null ? null : meta.seed);
    return MYSTERY_FALLBACKS[Math.floor(rng() * MYSTERY_FALLBACKS.length)];
  }

  // Already short enough and not a question -> keep as-is (the model's title).
  if (wordCount(t) <= 4 && !QUESTION_LEAD.test(t)) {
    // Preserve "The X of Y" capitalisation style by just returning it clean.
    return t;
  }

  // Too long or a leaked question opener -> deterministic mystery fallback.
  let out = mysteryFrom(t);
  out = out.replace(QUESTION_LEAD, "").trim();
  if (!out) {
    const rng = makeRng(meta?.seed == null ? null : meta.seed);
    out = MYSTERY_FALLBACKS[Math.floor(rng() * MYSTERY_FALLBACKS.length)];
  }
  return out.split(/\s+/).slice(0, 4).join(" ");
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

module.exports = { buildV10Title, buildV10Description, buildChapters, formatTime, makeRng, TAG_POOLS, buildV10MysteryTitle, QUESTION_LEAD };
