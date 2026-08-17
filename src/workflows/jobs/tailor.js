// Tailor: rewrites the real resume for a specific job (ATS keyword-leading),
// keeping every fact real. Outputs clean plain text (rendered to PDF on apply).
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");

async function tailorResume(job) {
  const realData = JSON.stringify({
    profile: {
      name: PROFILE.name,
      title: PROFILE.title,
      summary: PROFILE.summary,
      skills: PROFILE.skills,
      certifications: PROFILE.certifications,
      email: PROFILE.email,
      phone: PROFILE.phone,
      linkedin: PROFILE.linkedin,
      github: PROFILE.github,
    },
    portfolio: PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, url: p.url, facts: p.facts })),
  }, null, 1);

  const prompt = `Rewrite this candidate's resume so it fits THIS specific job posting. The employer wants someone who understands the ROLE — the job description explains exactly what that means — so every section must be tailored to it.

REQUIREMENTS:
0. HEADER — ALWAYS start with the header exactly like the candidate's original resume: NAME on one line, TITLE on the next line, then the contact line in this format: WAT (GMT+1) | email | phone | linkedin | github
1. PROFESSIONAL SUMMARY — make it PRECISE and DIRECT, in the candidate's own style (short, confident, few sentences), but adapted to THIS job and company. Lead with the specific value this role needs. Do NOT use vague filler.
2. SKILLS — list ONLY the skills relevant to THIS job. Drop anything irrelevant. Order by relevance to the JD's keywords.
3. PROJECTS — keep only the 1-3 most relevant projects, and rephrase their bullets to mirror THIS job's language and technology. (Prefer projects with live URLs: CloudVoid at https://cloudvoid.online and Myzelva at https://myzelva.com — include their URLs.)
4. EXPERIENCE — tailor it to reflect what the candidate actually DID, and ALSO how he can apply the same level of expertise to THIS company. Frame each bullet so the employer can picture him doing the same for them.
5. CERTIFICATIONS — ALWAYS include this section at the bottom, using the candidate's real certifications listed below. Never omit it.

HARD RULES:
- Keep EVERY fact real. Never invent employers, titles, years, numbers, projects, or URLs. Only the profile + portfolio facts below may be used.
- Plain text only: no markdown symbols, no hashtags, no tables, no bullets with asterisks or dashes. Use clean lines.
- One page, concise.

REAL CANDIDATE DATA:
${realData}

JOB:
- Company: ${job.company}
- Title: ${job.title}
- Description: ${(job.description || "").slice(0, 5000)}

Return JSON ONLY:
{"resumeText": "the full tailored resume as clean plain text, ending with the CERTIFICATIONS section"}`;

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
