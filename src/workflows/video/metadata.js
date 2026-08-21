// ForChi video metadata - title with exactly 3 hashtags (always ending #shorts), unique descriptions.
const CRYPTO = require("crypto");

// tag pools by vibe (safe, low-spam, on-brand). Exactly 2 chosen + #shorts = 3 total.
const TAG_POOLS = [
  ["philosophy", "motivation", "wisdom", "deepthoughts", "mindset", "lifelessons", "stoicism", "innerwork"],
  ["romance", "lovequotes", "poetry", "heartbreak", "tenderness", "lovestory", "romanticpoetry", "longing"],
  ["shorts", "viral", "foryou", "fyp", "ytshorts", "subscribe"],
];

function pickTag(rng, pool, used) {
  const c = pool.filter((t) => !used.includes(t));
  return c[Math.floor(rng() * c.length)];
}

// deterministic rng from a seed (so the same run reproduces), or random if seed=null
function makeRng(seed) {
  if (seed == null) {
    let s = CRYPTO.randomBytes(4).readUInt32BE(0);
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// title = "<base> #tag1 #tag2 #shorts"  (exactly 3 hashtags, #shorts always last)
function buildTitle(baseTitle, rng, forcedTags) {
  const r = rng || makeRng(null);
  const used = [];
  const t1 = forcedTags && forcedTags[0] ? forcedTags[0] : pickTag(r, TAG_POOLS[0], used);
  used.push(t1);
  const t2 = forcedTags && forcedTags[1] ? forcedTags[1] : pickTag(r, TAG_POOLS[1], used);
  return `${baseTitle} #${t1} #${t2} #shorts`;
}

// unique description: template rotation + script excerpt + timestamp hash (never duplicates)
function buildDescription({ script, baseTitle, mood, mode, seed }) {
  const r = makeRng(seed == null ? CRYPTO.randomBytes(4).readUInt32BE(0) : seed);
  const tmpl = [
    (t, m) => `${t} — a ${m} reflection. Tap to feel this one. Which line hit you hardest?`,
    (t, m) => `A ${m} meditation on ${t.toLowerCase()}. Save this for someone who needs it.`,
    (t, m) => `Sometimes the truth is softer spoken. ${t}. Let it sit with you a moment.`,
    (t, m) => `Written for the ones who feel too much. ${t}. Drop a word if it found you.`,
    (t, m) => `${m} in slow words. ${t}. Tell me what you'd say to the one who left.`,
    (t, m) => `Not a story. A feeling. ${t}. What would you change if you had one more day?`,
  ];
  const pick = tmpl[Math.floor(r() * tmpl.length)];
  const excerpt = script ? script.trim().slice(0, 120).replace(/\s+/g, " ") : baseTitle;
  const uniq = CRYPTO.createHash("md5").update(excerpt + seed + Date.now()).digest("hex").slice(0, 6);
  const moodText = mood || "reflection";
  const modeText = mode === "whisper" ? "whispered" : "spoken";
  const aiNote = "AI-assisted creation: AI voice + AI-generated instrumental. \ud83c\udfb5";
  return `${pick(excerpt, moodText)}\n\n${modeText} narration. ${excerpt}…\n\n${aiNote}\n#shorts #${TAG_POOLS[0][Math.floor(r() * TAG_POOLS[0].length)]}\nvid:${uniq}`;
}

module.exports = { buildTitle, buildDescription, makeRng, TAG_POOLS };
