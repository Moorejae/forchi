// Writer: generates the HUMAN-VOICE cover letter + screening answers.
// Grounded strictly in the real portfolio corpus + real company research.
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");

async function writeApplication({ job, companyResearch }) {
  const portfolioText = JSON.stringify(
    PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, url: p.url, facts: p.facts })),
    null, 1
  );

  const prompt = `You are writing a JOB APPLICATION cover letter for ${PROFILE.name} ("Victor"), IN HIS VOICE, following HIS exact template.

VOICE & FORMAT RULES (CRITICAL):
- SHORT. A cover letter says little but lands hard. Match the template's length — no extra sections, no padding.
- NO AI spacing: no dash characters (— or -), no hashes (#), no stars (* or **), no bullet markers, no markdown. Plain clean lines only.
- Natural, confident, first-person. Reads like he typed it in five minutes. Contractions are fine.
- NEVER invent facts, projects, URLs, quotes, or numbers that are not in the real data below.

REAL CANDIDATE DATA (use ONLY this):
- Title: ${PROFILE.title}
- Summary: ${PROFILE.summary}
- Testimonial (if this is empty, OMIT the feedback line entirely — do NOT invent a quote): "${PROFILE.testimonial}"
- Real projects: ${portfolioText}

JOB (prove you read it — mirror its actual tech and required skills):
- Company: ${job.company}
- Title: ${job.title}
- Description: ${(job.description || "").slice(0, 6000)}

COMPANY RESEARCH (real, from web search — use it to show you know the company; if empty, do NOT invent company facts):
${companyResearch || "(no research available)"}

COVER LETTER — follow the template EXACTLY, in this order, filling each part with real, job-specific content:

Hello [Hiring Manager Name],
I came across your opening for [Job Title], and it immediately caught my attention because [brief, direct reason tied to THIS job and company].
Instead of just listing past tasks, here is a direct look at the systems and AI solutions I have actually built and shipped in production:
[Project 1]: [1-sentence engineering description]. You can check it out live here: [URL only if the project has a real URL]
[Project 2]: [1-sentence engineering description]. You can check it out live here: [URL only if the project has a real URL]
[Only if the testimonial above is non-empty: Feedback from past collaborators/clients: "[the real quote]"]
As [a fitting role title — e.g. "an AI & AI Integration Engineer" or adapt to the job], my core focus is building production-grade workflows, multi-agent systems, and cloud infrastructure that hold up under real-world usage.
We can set up a brief call to discuss how we can cleanly integrate these AI systems into your current stack and map out how this can play out for your team.
Best regards,
P.S. [a light, professional human touch — MUST be different for every job, tied to THIS job's description and company]

RULES:
- Use 1-2 projects max, the most relevant to the job. Myzelva (https://myzelva.com) is the candidate's live prompt-engineering portfolio site — always include it as one of the projects. CloudVoid (https://cloudvoid.online) also has a live URL — prefer these two. ForChi and Flamchi are live 24/7 production Telegram bots with no web URL — say "live in production on Telegram" instead of a URL.
- If the hiring manager's name is unknown, use "Hello," — never invent a name.
- Sign with ONLY "Best regards," — no name and no links after it.
- The reason line and the P.S. MUST reference this specific job and company (prove you read the JD and know them).
- Replace every [bracket] with real content. Keep the whole letter SHORT.

Return JSON ONLY:
{"coverLetter": "the completed letter as plain text", "answers": [{"question": "string", "answer": "short natural answer"}]}`;

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
