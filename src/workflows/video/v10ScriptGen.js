// ForChi V10 script generator — writes the FIRST ORIGINAL 10-min script per the
// channel spec (theme rotation, obscure-history/Bible sourcing, 4-act structure,
// factual grounding via search) and emits a scene manifest the rest of the
// pipeline can consume (voice -> images -> assemble -> upload).
//
// Output files (runDir):
//   manifest.json  { style, scenes: [{n,label,shots:[{text,img}]}] }   (repl_voice/assemble format)
//   meta.json      { title, topic, theme, script, chapters:[{label,startSec}] }
//   narration.txt  (raw script for reference)
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const STATE = path.join(BASE, "temp_media", "v10_script_state.json");
const MODEL = process.env.V10_SCRIPT_MODEL || "gemini-3.5-flash";
const KEY = (process.env.GEMINI_PAID_API_KEY || "").trim();
// Gemini keys waterfall: the same proven multi-key list the bot uses everywhere
// (chat/voice/shorts all work on the VPS with GEMINI_KEYS). Fall back to the
// single paid key only if the list is empty.
function geminiKeys() {
  const raw = process.env.GEMINI_KEYS || "";
  const list = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (list.length) return list;
  return KEY ? [KEY] : [];
}
const SCRIPTS_DIR = path.join(BASE, "temp_media", "v10_run");
const TMIN = parseInt(process.env.V10_TARGET_MINUTES || "5", 10);
const countWords = (scs) => (scs || []).reduce((a, s) => a + ((s.narration || "").split(/\s+/).filter(Boolean).length), 0);

// THEME CATEGORIES — one per V10 YouTube playlist (user spec 2026-08-30).
// Rotation is ROUND-ROBIN across the 5 categories so every video lands in a
// different playlist in turn. Each category's themes clearly belong to it so the
// topic->playlist classifier routes correctly.
const THEME_CATEGORIES = [
  {
    playlist: "Church & Bible Stories",
    themes: [
      "Bible Histories & the Hidden Grace of Scripture",
      "Modern Church Stories of Faith & Forgiveness",
      "Ancient Prophets & the Cost of Speaking Truth",
      "Parables Reimagined for Modern Hearts",
      "Saints, Monks & Quiet Acts of Courage",
    ],
  },
  {
    playlist: "Family Stories",
    themes: [
      "Family Bonds, Rivalry & the Weight of Inheritance",
      "Mothers & Fathers Who Gave Everything",
      "Sibling Loyalty Across Generations",
      "Household Secrets & the Cost of Keeping Them",
      "Modern Family, Old Wounds & the Road Back",
    ],
  },
  {
    playlist: "World Folklore",
    themes: [
      "Untold Folklore from Africa, Europe & Asia",
      "Legends That Explain Human Nature",
      "Tricksters, Taboos & the Wisdom of Villages",
      "Myths of Power, Justice & Consequences",
      "Modern Folklore in an Ancient World",
      "Mythical Creatures & the Art of the Hunt",
      "Legendary Beasts: How They Hunt, Hide & Haunt",
      "Monsters of Myth & the Hunt to Survive Them",
      "Creatures of Forest, Sea & Sky: Folklore's Hunters",
    ],
  },
  {
    playlist: "Love & Relationship Stories",
    themes: [
      "Love That Outlasted Time & Distance",
      "Modern Dating & the Ache of Waiting",
      "Forbidden Love & the Cost of Devotion",
      "Historical Romances That Broke the Rules",
      "Marriage, Trust & the Long Game",
    ],
  },
  {
    playlist: "Book Summaries",
    themes: [
      "Book Summary: Wealth, Money & Mindset",
      "Book Summary: Psychology & Human Nature",
      "Book Summary: Power, Politics & Influence",
      "Book Summary: Philosophy, Religion & Spirituality",
      "Book Summary: Marriage, Friendship & Connection",
    ],
  },
];

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } }
function saveState(s) { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch {} }

function pickTheme(state) {
  // Round-robin across categories: keep a rolling category index in state so each
  // video is a different topic category (=> a different playlist) in turn.
  const catIdx = state.categoryIdx || 0;
  const cat = THEME_CATEGORIES[catIdx % THEME_CATEGORIES.length];
  // Within the category, rotate themes (avoid repeating until the pool is exhausted).
  const usedCat = state.usedByCategory || {};
  const used = usedCat[cat.playlist] || [];
  const fresh = cat.themes.filter((t) => !used.includes(t));
  const pool = fresh.length ? fresh : cat.themes;
  const theme = pool[Math.floor(Math.random() * pool.length)];
  usedCat[cat.playlist] = [...used, theme].slice(-cat.themes.length);
  state.usedByCategory = usedCat;
  state.categoryIdx = catIdx + 1;
  state.category = cat.playlist;
  state.usedThemes = [...(state.usedThemes || []), theme].slice(-20);
  saveState(state);
  console.log(`[v10script] category: ${cat.playlist} | theme: ${theme}`);
  return theme;
}

// Expand ONLY the narrations to reach a target word count (keeps scenes/structure intact).
async function expandScript(scenes, targetWords) {
  const cur = (scenes || []).map((s) => ({ n: s.n, narration: s.narration || "" }));
  const prompt = `You are expanding scene narrations for a storybook video. The total is currently too short; we
need about ${targetWords} words across ${cur.length} scenes. Keep each scene's story beat and scene identity
IDENTICAL, but expand each "narration" (2-4 sentences -> more vivid detail, psychology, sensory language,
wry family-safe asides, grounded historical context). Do NOT repeat sentences word-for-word. Return STRICT
JSON ONLY: {"narration": ["<expanded narration scene 1>", ...]} — one expanded narration string per scene,
in order, matching this current list:
${JSON.stringify(cur, null, 1)}`;
  try {
    const data = await callGemini(prompt);
    const arr = data && Array.isArray(data.narration) ? data.narration : null;
    if (arr && arr.length) {
      (scenes || []).forEach((s, i) => { if (arr[i] && String(arr[i]).trim()) s.narration = String(arr[i]).trim(); });
    }
  } catch (e) { console.warn("[v10script] expand failed, keeping original:", e.message); }
  return scenes;
}

// Search-grounded story research (Grokipedia/Wikipedia/Serper rotate through).
// HUNT for OBSCURE, UNTOLD folklore from ALL cultures — the channel's edge is
// telling stories people have NOT heard (African, European, Asian, Middle-Eastern).
const CULTURES = ["African", "West African", "Nigerian", "Ghanaian", "Egyptian", "Ethiopian",
  "European", "Celtic", "Nordic", "Slavic", "Eastern European", "Scandinavian", "Spanish", "Italian", "Greek",
  "Asian", "Japanese", "Chinese", "Korean", "Indian", "Southeast Asian", "Filipino", "Indonesian",
  "Middle-Eastern", "Persian", "Ottoman", "Arabian", "Jewish", "Mesopotamian", "Turkish", "Armenian"];
const BANNED_STORIES = [
  "Trojan Horse", "David and Goliath", "Noah's Ark", "Adam and Eve", "The Tortoise and the Hare",
  "King Midas", "Icarus", "The Boy Who Cried Wolf", "Cinderella", "Little Red Riding Hood",
  "Robin Hood", "The Fox and the Grapes", "The Lion and the Mouse", "Pandora's Box", "The Prodigal Son",
];

async function research(theme) {
  const culture = CULTURES[Math.floor(Math.random() * CULTURES.length)];
  const { searchWeb } = require("../../llm/webSearch.js");
  const queries = [
    `${culture} obscure folklore tale ${theme} lesson moral`,
    `${culture} lesser-known folk tale hidden story ${theme}`,
    `rare traditional ${culture} parable ${theme} psychology`,
  ];
  for (const q of queries) {
    try {
      const out = await searchWeb(q, 9000);
      if (out && out.results && out.results.length) {
        console.log(`[v10script] culture=${culture} source=${q.slice(0, 70)}`);
        return out.results.slice(0, 1400);
      }
    } catch (e) { console.warn(`[v10script] research failed (${q.slice(0, 40)}):`, e.message); }
  }
  return `No web results. Culture drawn: ${culture}. Proceed from general knowledge ONLY if you can name a real lesser-known tale; otherwise keep searching mentally for an obscure story — do not invent specific facts.`;
}

async function callGemini(prompt) {
  // Model tiers: newest flash first, rotate on any error (mirrors provider.js).
  const tiers = [...new Set([MODEL, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.0-flash"])];
  const keys = geminiKeys();
  if (!keys.length) throw new Error("no Gemini keys configured (GEMINI_KEYS / GEMINI_PAID_API_KEY)");
  let lastErr = "no keys tried";
  for (const key of keys) {
    nextModel: for (const m of tiers) {
      for (let a = 0; a < 2; a++) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 60000); // never hang the pipeline
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 9000, responseMimeType: "application/json" } }),
            signal: ctrl.signal,
          });
          clearTimeout(to);
          const t = await r.text();
          if (!r.ok) {
            lastErr = `HTTP ${r.status}`;
            await new Promise((s) => setTimeout(s, 4000 * (a + 1)));
            // A 429-throttled key stays throttled across models — skip it to the
            // next key instead of burning ~2.5 min on all model tiers.
            if (r.status === 429) break nextModel;
            continue;
          }
          const j = JSON.parse(t);
          const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          const m2 = txt.match(/\{[\s\S]*\}/);
          if (!m2) { lastErr = "no JSON"; continue; }
          return JSON.parse(m2[0]);
        } catch (e) { lastErr = e.message || String(e); await new Promise((s) => setTimeout(s, 3000)); }
      }
    }
  }
  throw new Error("script gen failed: " + lastErr);
}

// NARRATOR = the channel's host character: always red top + black trousers, present in
// scenes but never interacts with the story characters. STORY CHARACTERS = wear
// period-appropriate clothing of their culture/era, consistent per character.
const CHAR_SPEC = `V10 colorful storybook whiteboard art style: warm, gentle, family-friendly palette, light warm background with pure black ink line art and hand-drawn cross-hatch textures. THE NARRATOR is a stickman host who is ALWAYS present: large spherical white head, two small dot eyes, thin curved eyebrows, simple black line mouth, dense hand-drawn diagonal ink cross-hatch scribble body texture, simple rounded mitten hands, flat black feet — and he ALWAYS wears a SOLID BLACK suit jacket and DARK trousers with a dark ONE-EYED monocle (a single dark round lens over ONE eye, thin dark rim, short chain) in EVERY scene. THE NARRATOR IS A GIANT: he is drawn MUCH LARGER than every story character — towering over the scenes, head-and-shoulders above the story world — watching and gesturing from above but NEVER joining the characters. STORY CHARACTERS: stickmen of the same base design but SMALL beside the giant narrator; they wear clothing appropriate to their culture and time period (e.g. viking tunic, roman toga, asian robes, african garments — whatever the story's era/culture calls for), and each character's outfit is CONSISTENT across all their scenes. The SCENE / background is alive with soft COLOUR: colored objects, colored background elements, colored props, plants and architecture (storybook palette — warm, gentle, family-friendly) that bring every scene to life. ALL story characters are the SAME SIZE as each other — but the NARRATOR is a GIANT, much larger than all of them. CHARACTERS ARE NOT RACIALIZED: heads/faces are ALWAYS plain white spheres, bodies are ALWAYS the black-ink cross-hatch texture — NO skin color, NO flesh tones, NO coloured faces or bodies anywhere; the ONLY coloured element is clothing (the narrator's red top / a story character's single period garment). Rich but clean: each scene has several background objects to bring it to life (furniture, props, plants, architecture fitting the setting), all in soft storybook colour. NO captions, NO on-screen text, NO letters, NO numbers, NO symbols, NO gibberish ANYWHERE.`;

function buildPrompt(theme, researchText) {
  // Target length is configurable (V10_TARGET_MINUTES; default 5). Everything
  // downstream (word count, scene count, act timings) scales off it.
  // Measured: the Victor Moore voice (F5/Higgs) actually runs ~200 wpm of spoken
  // narration (a 750-word "5-min" script measured 3:42). So target ~200 wpm so the
  // final video hits the requested runtime, not 130-150.
  const WPM = parseInt(process.env.V10_WPM || "200", 10);
  const N_WORDS = Math.max(Math.round(TMIN * 180), Math.round(TMIN * WPM));
  const N_WORDS_LO = N_WORDS - 60;
  const N_WORDS_HI = N_WORDS + 60;
  const N_SCENES = Math.max(4, Math.round(TMIN * 2.6));
  const fmt = (frac) => { const t = TMIN * frac; const m = Math.floor(t); const s = Math.round((t - m) * 60); return `${m}:${String(s).padStart(2, "0")}`; };
  const act1e = fmt(0.15), act2e = fmt(0.5), act3e = fmt(0.8), end = fmt(1.0);
  return `You are a documentary scriptwriter for a family-friendly YouTube channel (adults AND children watch together). Channel rules: grounded & ethical; folklore/historical/Biblical events as psychological case studies; the viewer must walk away with an actionable life insight. Theme for THIS video: "${theme}".

RESEARCH (use facts, never invent):
${researchText}

STORY SELECTION RULE (the channel's identity — CRITICAL): Most storytelling channels repeat the same handful of over-told stories (Trojan Horse, David vs Goliath, King Midas, Icarus, The Boy Who Cried Wolf, Cinderella, Robin Hood, Noah's Ark, Pandora's Box, The Prodigal Son, The Tortoise and the Hare, etc.). THIS CHANNEL IS DIFFERENT: it tells UNTOLD stories — obscure folklore, legends, and historical episodes from African, European, Asian, and Middle-Eastern traditions that people have rarely or never heard. Pick ONE genuinely lesser-known story from the research (or from a real obscure tradition you know) and tell it in our unique voice with the psychological angle. If the research only surfaces famous stories, dig for the obscure corner of that same tradition instead of defaulting to a classic. The viewer should think "I've never heard this one before" — that is the channel's edge. We have millions of stories to tell.

HUMOR REQUIREMENT (important): This channel makes viewers SMILE, not just learn. Weave in 3-5 light, warm, family-safe moments of humor scattered through the script — a witty aside, a gentle irony, a relatable modern parallel ("basically the ancient version of X"), a dry one-liner about human nature, or a playful observation about the characters' absurdity. Humor must feel ORGANIC (rise naturally from the story/psychology), NEVER forced jokes or punchliney gags, and must never undercut the seriousness of a genuine emotional/ethical moment. Children AND adults should both catch the smile. Mark each humor beat with [🤭 HUMOR] right before the line that lands it.

FORBIDDEN PHRASES (HARD RULES — the channel NEVER uses these, ever): "watch till the end", "stick around to find out", "stay until the end", "make sure you stay", "don't go anywhere", "before we begin", "let's dive in", "thanks for watching", "like and subscribe", "see you next time", "hit that subscribe button". Do NOT instruct the audience to do ANYTHING with their time or attention. The hook works by opening a curiosity GAP that the story then closes — the viewer is pulled forward by the gap, never told to stay.

STRUCTURE (mandatory): The video ALWAYS opens with a NARRATOR COLD-OPEN scene (scene 1) that opens a curiosity GAP WITHOUT instructing the viewer to stay: the narrator states a specific, surprising, high-stakes claim or asks a concrete WHY/HOW question that implies a mechanism or answer coming later, then IMMEDIATELY drops into the story's pivotal moment. The open loop pulls the viewer forward on its own — never say "stay to the end". The close (last scene) has the narrator answer the opening question/claim, which is what closes the loop.

Write a ~${TMIN} minute script (about ${N_WORDS_LO}-${N_WORDS_HI} words, slow deliberate narration ~130 wpm) in the 4-act structure, paced by a 5-BEAT RETENTION ARC (each act carries its beat):
ACT I HOOK & COLD OPEN (0:00-${act1e}) — narrator cold-open question + drop into the pivotal moment. Build the hook as a HIGH-STAKES CONTRAST: (1) a mundane baseline the viewer relates to, (2) an extreme high-stakes contrast, (3) a shock anomaly (a number, absurd odds, an unbelievable fact), (4) a talent debunk (the protagonist was NOT a born genius), (5) a concrete implication the viewer now WANTS resolved ("the answer changes how you'll see every [X] from now on") — a promise of the answer WITHOUT telling them to stay.
ACT II CONTEXT/DESIRE/ESCALATION (${act1e}-${act2e}) — the world, desires, fatal flaw, decisions. Then SHATTER THE INTUITION: introduce the psychological/behavioral principle the story proves, explain why conventional wisdom gets it wrong, and anchor ONE sticky visual metaphor.
ACT III CLIMAX (${act2e}-${act3e}) — turning point, downfall/redemption. Deconstruct the mechanism: break the protagonist's flaw or the story's engine into ~3 atomic principles, each tied to a scene beat.
ACT IV PSYCHOLOGICAL & MORAL AUTOPSY (${act3e}-${end}) — why, the cognitive biases, connect to modern life, close with the narrator answering the opening question. End on a RESONANT PUNCHLINE / low-friction takeaway. NO generic outro — "thanks for watching", "like and subscribe", "see you next time" are FORBIDDEN; the video ends on the thought itself.

Then split the script into ${N_SCENES} SCENES (about ${N_SCENES - 2} to ${N_SCENES + 2} is fine). EACH scene must be a complete visual beat that the scene designer can render. For EACH scene provide:
- "n": scene number
- "label": short chapter title (2-4 words) for the timestamp
- "narration": the exact spoken words for that scene (2-4 sentences)
- "setting": the BACKGROUND for this scene (the location and its coloured objects — e.g. "a warm viking longhouse with a glowing hearth, wooden benches, hanging shields, a red woven rug" or "an empty storybook studio with the narrator's colourful desk"). This setting must be STABLE within the scene and consistent across the story.
- "characters": who is in the scene (e.g. "narrator (red top, black trousers) + Gunnar the viking warrior in a blue tunic"), each with their fixed period outfit
- "action": ONE clear action/pose the scene shows (what is happening)
- "frames": 4 MICRO-FRAME image-prompt variations of THIS SAME SCENE (SAME background, SAME camera angle, SAME framing — the FRAME is FIXED, pixel-identical background across all frames). This is CONCEPTUAL ILLUSTRATION: only the objects/characters INSIDE the frame change — they may MOVE, APPEAR, or DISAPPEAR as the narration describes (a ball is removed, a second person steps away, a flag appears, an object pops into the scene). e.g. frame 1 = base pose, frame 2 = a character moves / hand raises / eyebrow furrows, frame 3 = an object pops in or a prop changes state (a door cracks open, a candle gutters), frame 4 = an object disappears or a small expression shift / climactic detail (light spills in, a document is revealed). The camera NEVER moves and the composition NEVER changes between frames — the background must remain pixel-identical across all 4 frames; only the characters/props inside the fixed frame mutate.

TITLE SPEC (CRITICAL — the channel's click psychology, 2026-08-31): Humans are curious creatures; long-form channels win by opening a LOOP in the title that the video closes. The "title" MUST be a CURIOSITY-GAP hook, ideally a WHY-question:
  - "Why the Most Loyal Man in History Was Erased"
  - "Why We Fear the Truth More Than Death"
  - "Why the Winner of That War Was Never Celebrated"
Rules: (1) START with a curiosity word — preferably "Why", else "How", "What Nobody Tells You", "The Real Reason", "The Surprising Reason"; (2) be SPECIFIC to THIS story (name the person / place / event / object); (3) open an INFORMATION GAP — it promises a mechanism, reason, or answer the viewer must watch to get; (4) NO clickbait lies — the story genuinely delivers the promise; (5) 6-12 words, no quotes, no punctuation games. This title is ALSO used on the thumbnail, so keep it punchy.

Return STRICT JSON ONLY:
{"title":"...","topic":"...","theme":"...","script":"<full script text>","chapters":[{"label":"...","act":1}],"scenes":[{"n":1,"label":"...","narration":"...","setting":"...","characters":"...","action":"...","frames":["frame1 img prompt","frame2 img prompt","frame3 img prompt"]}]}`;
}

async function generate({ theme, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const st = loadState();
  const useTheme = theme || pickTheme(st);
  const category = st.category || null; // set by pickTheme (playlist category)
  saveState(st);
  console.log(`[v10script] theme: ${useTheme} (category: ${category || "n/a"})`);
  const researchText = await research(useTheme);
  console.log(`[v10script] research: ${researchText.length} chars`);
  let data = await callGemini(buildPrompt(useTheme, researchText));
  console.log(`[v10script] got ${(data.scenes || []).length} scenes, title="${data.title}"`);

  // ENFORCE TARGET LENGTH — Gemini under-writes the word target (a "5 min" script came
  // out ~3:40) and the Victor Moore voice runs ~200 wpm, so target ~200 wpm * minutes.
  // If the narration is short, expand each scene's narration in place (keeps the
  // scenes/setting/characters/frames; only lengthens the spoken text).
  const WPM = parseInt(process.env.V10_WPM || "200", 10);
  const targetWords = Math.max(Math.round(TMIN * 180), Math.round(TMIN * WPM));
  let words = countWords(data.scenes);
  if (words < targetWords * 0.93 && (data.scenes || []).length) {
    console.log(`[v10script] under target (${words}w < ${targetWords}w) — expanding narrations`);
    data.scenes = await expandScript(data.scenes, targetWords);
    words = countWords(data.scenes);
    console.log(`[v10script] after expand: ${words} words`);
  } else {
    console.log(`[v10script] on target: ${words} words`);
  }

  // Build the script manifest. The SCENE DESIGNER stage (v10SceneDesigner) later expands
  // each scene's setting/characters/action/frames into per-frame image prompts.
  const scenes = (data.scenes || []).map((s) => ({
    n: s.n, label: s.label,
    narration: s.narration || "",
    setting: s.setting || "",
    characters: s.characters || "",
    action: s.action || "",
    frames: Array.isArray(s.frames) ? s.frames.slice(0, 3) : [],
  })).filter((s) => s.narration && s.narration.trim());

  const manifest = { style: "V10 colorful storybook whiteboard, narrator red-top host, period-clothed characters", scenes };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1), "utf8");
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({
    title: data.title, topic: data.topic, theme: useTheme, category,
    script: data.script, chapters: data.chapters || [],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "narration.txt"), data.script || "", "utf8");
  return { manifest, meta: data, outDir };
}

module.exports = { generate, THEME_CATEGORIES, SCRIPTS_DIR };

if (require.main === module) {
  const fs2 = require("fs");
  const runId = process.argv[2] || "run_" + Date.now().toString(36);
  const outDir = path.join(SCRIPTS_DIR, runId);
  const themeArg = process.argv[3] === "--theme" ? process.argv[4] : null;
  generate({ theme: themeArg, outDir }).then((r) => {
    console.log("[v10script] WROTE", path.join(r.outDir, "manifest.json"), "-", r.manifest.scenes.length, "scenes");
  }).catch((e) => { console.error("[v10script] FATAL", e.message); process.exit(1); });
}
