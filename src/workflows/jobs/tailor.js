// Tailor: rewrites the real resume for a specific job (ATS keyword-leading),
// keeping every fact real. Outputs clean plain text (rendered to PDF on apply).
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");
const { detectLanguage, translateText } = require("./lang");

async function tailorResume(job, companyResearch) {
  const lang = detectLanguage(job.description || "");  const realData = JSON.stringify({
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
    // REAL work history (from the base resume) — never invent more.
    experience: PROFILE.experience.map((e) => ({
      role: e.role, company: e.company, years: e.years, bullets: e.bullets,
    })),
    portfolio: PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, url: p.url, facts: p.facts })),
    // Company research — used ONLY to relate experience to THIS company's vision.
    companyResearch: companyResearch || null,
  }, null, 1);

  const prompt = `Rewrite this candidate's resume so it fits THIS specific job posting. The employer wants someone who understands the ROLE — the job description explains exactly what that means — so every section must be tailored to it.

REQUIREMENTS:
0. HEADER — ALWAYS start with the header exactly like the candidate's original resume: NAME on one line, TITLE on the next line, then the contact line in this format: WAT (GMT+1) | email | phone | linkedin | github
1. PROFESSIONAL SUMMARY — make it PRECISE and DIRECT, in the candidate's own style (short, confident, few sentences), but adapted to THIS job and company. Lead with the specific value this role needs. Do NOT use vague filler.
2. SKILLS — list ONLY the skills relevant to THIS job. Drop anything irrelevant. Order by relevance to the JD's keywords.
3. PROJECTS — keep only the 1-3 most relevant projects, and rephrase their bullets to mirror THIS job's language and technology. (Prefer projects with live URLs: CloudVoid at https://cloudvoid.online and Myzelva at https://myzelva.com — include their URLs.)
4. EXPERIENCE — THIS IS THE DIFFERENTIATOR. Format each real entry EXACTLY like this proven template:
   ROLE | COMPANY | REMOTE
   DATES
   - bullet
   - bullet

   For each entry write 2-3 bullets, each ONE action-oriented line that:
   - states what was ACTUALLY built, using ONLY the real "experience" data below (never invent employers, roles, dates, projects, or numbers),
   - MIRRORS THIS JOB'S OWN LANGUAGE AND TECHNOLOGY — use the JD's exact terms, frameworks, and pain points when describing the real work, so HR instantly sees you read their description,
   - states the real result honestly — DO NOT invent metrics (no "reduced by 40%", no "99.99% uptime", no "5+ microservices" unless the real data actually says it).
   Do NOT add generic filler like "same approach I'd bring to your vision". Mirroring their exact vocabulary in your real accomplishments IS the proof you read the JD.
5. CERTIFICATIONS — ALWAYS include this section at the bottom, using the candidate's real certifications listed below. Never omit it.

HARD RULES:
- Keep EVERY fact real. Never invent employers, titles, years, numbers, projects, or URLs. Only the profile + portfolio facts below may be used.
- LANGUAGE: The job description is in ${lang}. Write the ENTIRE tailored resume in ${lang} (the candidate's real facts are given in English — translate them faithfully). Do NOT mix languages.
- Plain text only: no markdown symbols, no hashtags, no tables, no bullets with asterisks or dashes. Use clean lines.
- ONE PAGE: keep it tight — summary max 2 sentences, skills 3-4 compact lines, each project max 2 short bullets, each experience entry max 2 short lines, certifications 1 line each. Shorten until it fits one US Letter page.

REAL CANDIDATE DATA:
${realData}

JOB:
- Company: ${job.company}
- Title: ${job.title}
- Description: ${(job.description || "").slice(0, 5000)}

Return JSON ONLY:
{"resumeText": "the full tailored resume as clean plain text, ending with the CERTIFICATIONS section"}

REMINDER BEFORE ANSWERING: if the job is not in English, EVERY line of "resumeText" MUST be entirely in ${lang} — headings, summary, skills, projects, experience, certifications. Never output English for a non-English job.`;

  try {
    const raw = await generate(prompt, { type: "object", maxTokens: 1500 });
    const p = JSON.parse(raw);
    const resume = (p.resumeText || "").replace(/https?:\/\//g, "").trim();
    // Hard guarantee: for non-English jobs, translate the whole resume.
    return lang === "English" ? resume : await translateText(resume, lang);
  } catch (e) {
    console.warn("[Jobs] Tailor failed:", e.message);
    // Retry once with a conciseness constraint to stay under the token budget.
    try {
      const raw2 = await generate(`${prompt}\n\nIMPORTANT: Keep the resume CONCISE — under 1800 characters total.`, { type: "object", maxTokens: 1500 });
      const p = JSON.parse(raw2);
      const resume2 = (p.resumeText || "").replace(/https?:\/\//g, "").trim();
      return lang === "English" ? resume2 : await translateText(resume2, lang);
    } catch (e2) {
      console.warn("[Jobs] Tailor retry failed:", e2.message);
      return "";
    }
  }
}

module.exports = { tailorResume };
