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
const SCRIPTS_DIR = path.join(BASE, "temp_media", "v10_run");
const TMIN = parseInt(process.env.V10_TARGET_MINUTES || "5", 10);
const countWords = (scs) => (scs || []).reduce((a, s) => a + ((s.narration || "").split(/\s+/).filter(Boolean).length), 0);

const THEMES = [
  "Self-Control vs Impulsivity", "Pride, Arrogance, & Pyrrhic Victories",
  "Hypocrisy, Deception, & Double Lives", "Unchecked Greed & Collective Delusion",
  "Blind Trust, Rumor, & The Danger of Face-Value Judgments",
  "Self-Sacrifice & Radical Empathy", "Love, Lust, & Political Manipulation",
  "Betrayal, Cold Ambition, & False Loyalty", "Power Dynamics, Tyranny, & Mob Psychology",
  "Slander, Framing, & Emotional Manipulation",
];

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } }
function saveState(s) { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch {} }

function pickTheme(state) {
  const used = state.usedThemes || [];
  const fresh = THEMES.filter((t) => !used.includes(t));
  const pool = fresh.length ? fresh : THEMES;
  const theme = pool[Math.floor(Math.random() * pool.length)];
  state.usedThemes = [...(state.usedThemes || []), theme].slice(-THEMES.length);
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
  const chain = [MODEL, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash"];
  let lastErr = null;
  for (const m of [...new Set(chain)]) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 9000, responseMimeType: "application/json" } }),
        });
        const t = await r.text();
        if (!r.ok) { lastErr = `HTTP ${r.status}`; await new Promise((s) => setTimeout(s, 8000 * (a + 1))); continue; }
        const j = JSON.parse(t);
        const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        const m2 = txt.match(/\{[\s\S]*\}/);
        if (!m2) { lastErr = "no JSON"; continue; }
        return JSON.parse(m2[0]);
      } catch (e) { lastErr = e.message; await new Promise((s) => setTimeout(s, 8000 * (a + 1))); }
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
  const N_WORDS = Math.max(500, Math.round(TMIN * 150));
  const N_WORDS_LO = N_WORDS - 40;
  const N_WORDS_HI = N_WORDS + 40;
  const N_SCENES = Math.max(9, Math.round(TMIN * 2.2));
  const fmt = (frac) => { const t = TMIN * frac; const m = Math.floor(t); const s = Math.round((t - m) * 60); return `${m}:${String(s).padStart(2, "0")}`; };
  const act1e = fmt(0.15), act2e = fmt(0.5), act3e = fmt(0.8), end = fmt(1.0);
  return `You are a documentary scriptwriter for a family-friendly YouTube channel (adults AND children watch together). Channel rules: grounded & ethical; folklore/historical/Biblical events as psychological case studies; the viewer must walk away with an actionable life insight. Theme for THIS video: "${theme}".

RESEARCH (use facts, never invent):
${researchText}

STORY SELECTION RULE (the channel's identity — CRITICAL): Most storytelling channels repeat the same handful of over-told stories (Trojan Horse, David vs Goliath, King Midas, Icarus, The Boy Who Cried Wolf, Cinderella, Robin Hood, Noah's Ark, Pandora's Box, The Prodigal Son, The Tortoise and the Hare, etc.). THIS CHANNEL IS DIFFERENT: it tells UNTOLD stories — obscure folklore, legends, and historical episodes from African, European, Asian, and Middle-Eastern traditions that people have rarely or never heard. Pick ONE genuinely lesser-known story from the research (or from a real obscure tradition you know) and tell it in our unique voice with the psychological angle. If the research only surfaces famous stories, dig for the obscure corner of that same tradition instead of defaulting to a classic. The viewer should think "I've never heard this one before" — that is the channel's edge. We have millions of stories to tell.

HUMOR REQUIREMENT (important): This channel makes viewers SMILE, not just learn. Weave in 3-5 light, warm, family-safe moments of humor scattered through the script — a witty aside, a gentle irony, a relatable modern parallel ("basically the ancient version of X"), a dry one-liner about human nature, or a playful observation about the characters' absurdity. Humor must feel ORGANIC (rise naturally from the story/psychology), NEVER forced jokes or punchliney gags, and must never undercut the seriousness of a genuine emotional/ethical moment. Children AND adults should both catch the smile. Mark each humor beat with [🤭 HUMOR] right before the line that lands it.

STRUCTURE (mandatory): The video ALWAYS opens with a NARRATOR COLD-OPEN scene (scene 1) where the narrator flips a claim into a question and tells the audience to STAY UNTIL THE END to get the answer. This is a direct-to-camera narrator scene (narrator + maybe a simple prop). Then tell the story. Close the video (last scene) back with the narrator answering the opening question.

Write a ~${TMIN} minute script (about ${N_WORDS_LO}-${N_WORDS_HI} words, slow deliberate narration ~130 wpm) in the 4-act structure, paced by a 5-BEAT RETENTION ARC (each act carries its beat):
ACT I HOOK & COLD OPEN (0:00-${act1e}) — narrator cold-open question + drop into the pivotal moment. Build the hook as a HIGH-STAKES CONTRAST: (1) a mundane baseline the viewer relates to, (2) an extreme high-stakes contrast, (3) a shock anomaly (a number, absurd odds, an unbelievable fact), (4) a talent debunk (the protagonist was NOT a born genius), (5) a concrete promise ("stay to the end and I'll show you the mechanism").
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
- "frames": 4 MICRO-FRAME image-prompt variations of THIS SAME SCENE (SAME background, SAME camera angle, SAME framing, SAME character positions/sizes/outfits) that differ ONLY by a SMALL ACTION/POSE/EXPRESSION/PROP mutation — the tiny changes that create the "illusion of animation" when cut together ~every 2-3 seconds. e.g. frame 1 = base pose, frame 2 = hand raises / eyebrow furrows, frame 3 = an object pops into the scene or a prop changes state (a door cracks open, a candle gutters), frame 4 = a small expression shift or climactic detail (light spills in, a document is revealed). The camera NEVER moves between frames — the background must remain pixel-identical across all 4 frames; only the character/prop mutates.

Return STRICT JSON ONLY:
{"title":"...","topic":"...","theme":"...","script":"<full script text>","chapters":[{"label":"...","act":1}],"scenes":[{"n":1,"label":"...","narration":"...","setting":"...","characters":"...","action":"...","frames":["frame1 img prompt","frame2 img prompt","frame3 img prompt"]}]}`;
}

async function generate({ theme, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const st = loadState();
  const useTheme = theme || pickTheme(st);
  saveState(st);
  console.log(`[v10script] theme: ${useTheme}`);
  const researchText = await research(useTheme);
  console.log(`[v10script] research: ${researchText.length} chars`);
  let data = await callGemini(buildPrompt(useTheme, researchText));
  console.log(`[v10script] got ${(data.scenes || []).length} scenes, title="${data.title}"`);

  // ENFORCE TARGET LENGTH — Gemini under-writes the word target (a "5 min" script came
  // out ~3:40) and the Victor Moore voice runs ~150 wpm, so target ~150 wpm * minutes.
  // If the narration is short, expand each scene's narration in place (keeps the
  // scenes/setting/characters/frames; only lengthens the spoken text).
  const targetWords = Math.max(500, Math.round(TMIN * 150));
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
    title: data.title, topic: data.topic, theme: useTheme, script: data.script, chapters: data.chapters || [],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "narration.txt"), data.script || "", "utf8");
  return { manifest, meta: data, outDir };
}

module.exports = { generate, THEMES, SCRIPTS_DIR };

if (require.main === module) {
  const fs2 = require("fs");
  const runId = process.argv[2] || "run_" + Date.now().toString(36);
  const outDir = path.join(SCRIPTS_DIR, runId);
  const themeArg = process.argv[3] === "--theme" ? process.argv[4] : null;
  generate({ theme: themeArg, outDir }).then((r) => {
    console.log("[v10script] WROTE", path.join(r.outDir, "manifest.json"), "-", r.manifest.scenes.length, "scenes");
  }).catch((e) => { console.error("[v10script] FATAL", e.message); process.exit(1); });
}
