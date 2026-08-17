// Tailor: rewrites the real resume for a specific job (ATS keyword-leading),
// keeping every fact real. Outputs clean plain text (rendered to PDF on apply).
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");

async function tailorResume(job) {
  const realData = JSON.stringify({
    profile: PROFILE,
    portfolio: PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, facts: p.facts })),
  }, null, 1);

  const prompt = `Rewrite this candidate's resume so it fits THIS specific job posting. ATS-tailoring: lead with the JD's exact keywords and required skills, rephrase bullets to mirror the JD's language, drop irrelevant projects, tighten everything to one page.

HARD RULES:
- Keep EVERY fact real. Never invent employers, titles, years, numbers, or projects. Only the profile + portfolio facts below may be used.
- No markdown symbols, no hashtags, no tables.
- Sections: SUMMARY / SKILLS / PROJECTS / EXPERIENCE / CERTIFICATIONS (omit sections with no real content).

REAL CANDIDATE DATA:
${realData}

JOB:
- Company: ${job.company}
- Title: ${job.title}
- Description: ${(job.description || "").slice(0, 5000)}

Return JSON ONLY:
{"resumeText": "the full tailored resume as clean plain text"}`;

  try {
    const raw = await generate(prompt, { type: "object", maxTokens: 1500 });
    const p = JSON.parse(raw);
    return (p.resumeText || "").trim();
  } catch (e) {
    console.warn("[Jobs] Tailor failed:", e.message);
    // Retry once with a conciseness constraint to stay under the token budget.
    try {
      const raw2 = await generate(`${prompt}\n\nIMPORTANT: Keep the resume CONCISE — under 1800 characters total.`, { type: "object", maxTokens: 1500 });
      const p = JSON.parse(raw2);
      return (p.resumeText || "").trim();
    } catch (e2) {
      console.warn("[Jobs] Tailor retry failed:", e2.message);
      return "";
    }
  }
}

module.exports = { tailorResume };
