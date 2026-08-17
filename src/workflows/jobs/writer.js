// Writer: generates the HUMAN-VOICE cover letter + screening answers.
// Grounded strictly in the real portfolio corpus + real company research.
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");

async function writeApplication({ job, companyResearch }) {
  const portfolioText = JSON.stringify(
    PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, facts: p.facts })),
    null, 1
  );

  const prompt = `You are writing a JOB APPLICATION for ${PROFILE.name} ("Victor"), IN HIS VOICE.

VOICE — CRITICAL:
- Natural conversational voice, exactly how a sharp engineer types quickly. Plain, direct, first-person, confident, short sentences. NOT poetic (that is only for his Facebook persona).
- NO "AI spacing": no bullet-spam inside the letter, no robotic em-dash rhythm, no "As an AI", no "I am excited to apply for this position", no clichés, no buzzword soup. It must read like he wrote it in five minutes on a lunch break.
- Use contractions naturally ("I've", "I'm", "I don't"). Vary sentence length. Be specific and concrete.

GROUNDING — NEVER FABRICATE. The ONLY real facts about the candidate are these (from his resume and project blueprints). You may tailor and rephrase them, but you MUST NOT invent projects, employers, numbers, years, or companies:
${portfolioText}

PROFILE:
- Title: ${PROFILE.title}
- Summary: ${PROFILE.summary}

JOB (prove you read it — mirror its actual tech and required skills):
- Company: ${job.company}
- Title: ${job.title}
- Location: ${job.location || "n/a"}
- Description: ${(job.description || "").slice(0, 6000)}

COMPANY RESEARCH (real, from web search — use it to show you know the company; if empty, do NOT invent company facts):
${companyResearch || "(no research available)"}

The cover letter MUST demonstrate three things:
(a) you read the description — mirror the actual stack/skills it asks for,
(b) you know the company — reference something real from the research or their public products,
(c) why they need someone like you — map 1-2 REAL portfolio projects to their problems.

Format: 2-4 short plain paragraphs, first person. No headings, no bullets, no hashtags. End with "Victor Agu".

Also extract the screening questions from the JD (e.g. "Why are you a good fit?", "What is your salary expectation?") and write short, honest, natural answers in the same voice.

Return JSON ONLY:
{"coverLetter": "string", "answers": [{"question": "string", "answer": "string"}]}`;

  try {
    const raw = await generate(prompt, { type: "object", maxTokens: 1200 });
    const p = JSON.parse(raw);
    return {
      coverLetter: p.coverLetter || "",
      answers: Array.isArray(p.answers) ? p.answers : [],
    };
  } catch (e) {
    console.warn("[Jobs] Writer failed:", e.message);
    return { coverLetter: "", answers: [] };
  }
}

module.exports = { writeApplication };
