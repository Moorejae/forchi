// V10 SCENE DESIGNER — the stage between script and images.
// A Google image model (Nano Banana family via the enterprise Agent Platform client)
// reads each script scene (setting / characters / action / frames) and writes the
// FINAL per-frame image prompts: one stable background + 3 camera/object variations,
// all with the consistent narrator (red top, black trousers) and period-clothed
// characters. Also splits each scene's narration into 3 chunks (one per frame) so the
// assembler holds each frame during its narration slice.
//
// Input : runDir/manifest.json  (script gen output: scenes[].narration/setting/characters/action/frames)
// Output: runDir/manifest.json  (pipeline format:   scenes[].shots[].text/.img, 3 shots per scene)
//         runDir/design.json    (the raw designer output, for debugging)
//
// CLI: node src/workflows/video/v10SceneDesigner.js <runDir>
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "..", ".env") });

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const KEY = (process.env.Agent_Platform_key || process.env.GEMINI_PAID_API_KEY || "").trim();
// Nano Banana family — enterprise mode routes to the key's real project
const DESIGNER_MODELS = ["gemini-3.1-flash-image", "gemini-2.5-flash-image", "gemini-3.1-flash-lite-image"];

const NARRATOR = "the NARRATOR stickman host — a GIANT (drawn MUCH larger than every story character, looming over the scenes or head-and-shoulders above the story world) with a large spherical white head, two dot eyes, thin curved eyebrows, a simple black line mouth and a dark ONE-EYED monocle (a single dark round lens over ONE eye, thin dark rim, short chain), wearing a SOLID BLACK suit jacket and dark trousers — who watches and gestures from above but never joins the story";

// 6-TIER PROMPT ENGINE (research): Art Style DNA + Character DNA + Action Delta +
// Environment Anchor + Lighting/Atmosphere + Rendering Params.
const STYLE_LIGHT = "V10 colorful storybook whiteboard art style: warm, gentle, family-friendly palette. Light warm background with pure black ink line art and hand-drawn cross-hatch textures, clean high-contrast illustration. The SCENE is alive with soft COLOUR: colored background elements, colored furniture, colored props, plants and architecture (soft greens, warm woods, muted ambers, gentle blues) that bring the scene to life. The NARRATOR is a GIANT — drawn MUCH larger than the story characters, towering over the scene — and wears a SOLID BLACK suit jacket and dark trousers with a dark one-eyed monocle over one eye; story characters wear ONE period garment with a consistent colour per character and are all the SAME SIZE as each other (but small beside the narrator). CHARACTERS ARE NOT RACIALIZED: heads/faces are ALWAYS plain white spheres, bodies are ALWAYS black-ink cross-hatch — NO skin color, NO flesh tones, NO coloured faces or bodies anywhere; the ONLY coloured element is clothing. NO text, NO letters, NO numbers, NO symbols, NO gibberish anywhere.";
const STYLE_DARK = "V10 noir graphic-novel art style: dark low-key background, deep ink hatching, dynamic chiaroscuro lighting, moody atmospheric volumetric light, subdued desaturated palette with warm amber and crimson rim lighting on the characters. NO text, NO letters, NO numbers, NO symbols, NO gibberish.";
const STYLE = STYLE_LIGHT;
const MICRO_FRAMES = parseInt(process.env.V10_FRAMES_PER_SCENE || "4", 10);

function splitNarration(text, n) {
  // n word-balanced chunks, NEVER duplicating content (dup = repeated speech + frame
  // misalignment). Pure word-split; audio rejoins to one phrase per scene.
  const clean = (text || "").replace(/\s+/g, " ").trim();
  n = Math.max(1, n || MICRO_FRAMES);
  if (!clean) return new Array(n).fill("");
  const words = clean.split(/\s+/);
  if (n <= 1) return [clean].concat(new Array(n - 1).fill(""));
  const k = Math.max(1, Math.ceil(words.length / n));
  const chunks = [];
  for (let c = 0; c < n; c++) {
    const start = c * k;
    if (start >= words.length) { chunks.push(""); continue; }
    chunks.push(words.slice(start, start + k).join(" "));
  }
  return chunks;
}

async function callGemini(prompt) {
  const { GoogleGenAI } = require("@google/genai");
  for (const model of DESIGNER_MODELS) {
    let lastErr = null;
    for (let a = 0; a < 3; a++) {
      try {
        const client = new GoogleGenAI({ api_key: KEY, enterprise: true });
        const resp = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseModalities: ["TEXT"], temperature: 0.4, maxOutputTokens: 6000 },
        });
        const txt = (resp.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) { lastErr = "no JSON"; continue; }
        return JSON.parse(m[0]);
      } catch (e) {
        lastErr = e.message;
        await new Promise((r) => setTimeout(r, 8000 * (a + 1)));
      }
    }
    console.warn(`[designer] ${model} failed: ${lastErr}`);
  }
  throw new Error("scene designer: all models failed");
}

async function designScene(sc, idx) {
  const framePrompts = (sc.frames && sc.frames.length ? sc.frames : []);
  const nFrames = Math.max(3, Math.min(parseInt(process.env.V10_FRAMES_PER_SCENE || "4", 10), 6));
  const deltaHint = framePrompts.length ? `Intended micro-mutations (SMALL action/pose/expression/prop changes, camera FIXED): ${framePrompts.slice(0, nFrames).join(" | ")}` : "";
  const prompt = `You are the V10 SCENE DESIGNER. Turn ONE script scene into ${nFrames} MICRO-FRAME image prompts for a whiteboard storybook video. Micro-frames are NEAR-IDENTICAL stills of the SAME locked background and characters that differ by ONE tiny change each (a hand raises, an eyebrow furrows, an object pops in, a prop changes state, light spills in) — cut together ~every 2s they create the illusion of animation.

${STYLE}

NARRATOR: ${NARRATOR}.

SCENE ${idx}:
- setting (background, must be STABLE/identical across ALL ${nFrames} frames): ${sc.setting || "(default: warm whiteboard studio)"}
- characters (keep outfits consistent + all same size): ${sc.characters || "narrator only"}
- action (the story beat): ${sc.action || "the narrator narrates"}
${deltaHint}

Write STRICT JSON ONLY:
{"bg": "<ONE complete background prompt — the setting + all its objects, reusable in every frame>", "frames": ["<frame1: bg + narrator + characters, BASE pose>", "<frame2: EXACT same bg + characters + SAME camera/framing, only ONE small change: ...>", "... ${nFrames} frames total ..."]}

Rules: every frame prompt must START with the same background sentence (verbatim). The camera NEVER moves between frames; each subsequent frame changes ONLY one small detail (pose/expression/prop). Always include the narrator (red top, black trousers). All characters same size. NO text anywhere.`;
  const data = await callGemini(prompt);
  let frames = (data.frames || []).slice(0, nFrames).map((f) => (f || "").trim());
  while (frames.length < nFrames) frames.push(frames.length ? frames[frames.length - 1] : "the narrator narrates, base pose");
  return {
    bg: (data.bg || "").trim(),
    frames,
  };
}

async function run(runDir) {
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const scenes = manifest.scenes || [];
  console.log(`[designer] designing ${scenes.length} scenes -> 3 frames each`);

  const outScenes = [];
  const designLog = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const n = i + 1;
    if (!sc.narration || !sc.narration.trim()) { console.log(`  scene ${n}: no narration, skip`); continue; }
    console.log(`[designer] scene ${n}: ${(sc.label || "").slice(0, 30)}`);
    const d = await designScene(sc, n);
    const chunks = splitNarration(sc.narration, d.frames.length);
    const shots = d.frames.map((img, j) => ({
      text: chunks[j] || "",
      img: `${img}`.trim(),
    })).filter((s) => s.img);
    if (!shots.length) { console.log(`  scene ${n}: no frames designed, skip`); continue; }
    outScenes.push({ n, label: sc.label || `Scene ${n}`, shots });
    designLog.push({ n, label: sc.label, bg: d.bg, frames: d.frames, chunks: [c1, c2, c3] });
    console.log(`  -> ${shots.length} shots designed`);
  }

  const outManifest = { style: manifest.style, scenes: outScenes };
  fs.writeFileSync(manifestPath, JSON.stringify(outManifest, null, 1), "utf8");
  fs.writeFileSync(path.join(runDir, "design.json"), JSON.stringify(designLog, null, 1), "utf8");
  console.log(`[designer] wrote ${outScenes.length} designed scenes -> ${manifestPath}`);
  return { scenes: outScenes.length, shots: outScenes.reduce((a, s) => a + s.shots.length, 0) };
}

module.exports = { run };

if (require.main === module) {
  const runDir = process.argv[2] || path.join(BASE, "temp_media", "v10_run", "test");
  run(runDir).then((r) => { console.log("[designer] done:", JSON.stringify(r)); })
    .catch((e) => { console.error("[designer] FATAL", e.message); process.exit(1); });
}
