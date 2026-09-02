// Tailor: rewrites the real resume for a specific job (ATS keyword-leading),
// keeping every fact real. Outputs clean plain text (rendered to PDF on apply).
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");
const { detectLanguage, translateText } = require("./lang");

// USER DIRECTIVE (2026-09-02): three resume versions — headline + summary swap
// to match the role being applied to. Pick by keyword match on the job title +
// description; fall back to cloud-ai.
function pickResumeVersion(job) {
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const versions = PROFILE.resumeVersions || [];
  if (!versions.length) return { headline: PROFILE.title, summary: PROFILE.summary };
  // DevOps / SRE / platform / infrastructure
  if (/(devops|sre|site reliability|platform engineer|cloud engineer|infrastructure|kubernetes|docker|terraform|ci\/cd|linux|release)/.test(text)) {
    return versions.find((v) => v.key === "devops") || versions[0];
  }
  // Automation / workflow
  if (/(workflow|automation|rpa|n8n|zapier|process autom|ai agent|agentic|trigger|pipeline|integration autom)/.test(text)) {
    return versions.find((v) => v.key === "automation") || versions[0];
  }
  // Default: cloud & AI
  return versions.find((v) => v.key === "cloud-ai") || versions[0];
}

async function tailorResume(job, companyResearch) {
  const lang = detectLanguage(job.description || "");
  // USER DIRECTIVE (2026-09-02): pick the resume version (headline + summary)
  // that best matches THIS job, so the headline + professional summary adapt to
  // the role being applied to. Fall back to cloud-ai.
  const version = pickResumeVersion(job);
  const realData = JSON.stringify({
    profile: {
      name: PROFILE.name,
      // headline + summary now come from the selected version.
      headline: version.headline,
      summary: version.summary,
      skills: PROFILE.skills,
      certifications: PROFILE.certifications,
      email: PROFILE.email,
      phone: PROFILE.phone,
      linkedin: PROFILE.linkedin,
      github: PROFILE.github,
    },
    // REAL work history (from the base resume) — never invent more.
    // USER DIRECTIVE: company / title / dates are DROPPED from the resume body
    // (handled in the ATS form fields), so only the project name + bullets are
    // rendered. Bullets should read like Jennifer's: strong action verb + a
    // concrete, real result/metric where one exists.
    experience: PROFILE.experience.map((e) => ({
      name: e.company ? e.company.split(" — ")[0] : e.role, // project name only
      bullets: e.bullets,
    })),
    portfolio: PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, url: p.url, facts: p.facts })),
    // Company research — used ONLY to relate experience to THIS company's vision.
    companyResearch: companyResearch || null,
  }, null, 1);

  const prompt = `Rewrite this candidate's resume so it fits THIS specific job posting. The employer wants someone who understands the ROLE — the job description explains exactly what that means — so every section must be tailored to it.

REQUIREMENTS:
0. HEADER — ALWAYS start with the header exactly like this: NAME on one line, then the HEADLINE (given below) on the next line, then the contact line in this format: WAT (GMT+1) | email | phone | linkedin | github
1. PROFESSIONAL SUMMARY — use the SUMMARY given below, lightly adapted to THIS job and company (keep it short, confident, a few sentences, and lead with the specific value this role needs). Do NOT use vague filler.
2. SKILLS — list ONLY the skills relevant to THIS job. Drop anything irrelevant. Order by relevance to the JD's keywords.
3. PROJECTS — keep only the 1-3 most relevant projects, and rephrase their bullets to mirror THIS job's language and technology. (Prefer projects with live URLs: CloudVoid at https://cloudvoid.online, Myzelva at https://myzelva.com, and the YouTube automation channel at https://www.youtube.com/@sirxlud.) Format EACH project EXACTLY like this:
   PROJECT NAME
   - bullet
   - bullet
   (NO company line, NO role line, NO dates line — those are handled in the application form. Just the project name, then its bullets.)
4. EXPERIENCE — THIS IS THE DIFFERENTIATOR. Format each real entry EXACTLY like this proven template:
   PROJECT NAME
   - bullet
   - bullet
   (NO "ROLE | COMPANY | REMOTE", NO DATES line — drop company, title, and dates entirely.)

   For each entry write 2-3 bullets, each ONE action-oriented line that:
   - starts with a STRONG ACTION VERB (Built, Shipped, Automated, Integrated, Designed, Migrated, Hardened, Wired),
   - states what was ACTUALLY built, using ONLY the real "experience" data below (never invent employers, roles, dates, projects, or numbers),
   - MIRRORS THIS JOB'S OWN LANGUAGE AND TECHNOLOGY — use the JD's exact terms, frameworks, and pain points when describing the real work, so HR instantly sees you read their description,
   - states the real result honestly and specifically — where the real data supports it, include the concrete metric (e.g. "2 videos a day", "15 chains", "148MB bundle", "~70% blind accuracy", "6 discarded approaches"), in the same punchy, results-first style as these examples:
     "Conducted 500+ calls and converted prospects into real-estate investments"
     "Reduced refund processing time by 80% with automated triggers"
     "Raised NPS from 45 to 62 through customer-insight initiatives"
   Do NOT invent metrics the real data doesn't say. Mirroring their exact vocabulary in your real accomplishments IS the proof you read the JD.
5. CERTIFICATIONS — ALWAYS include this section at the bottom, using the candidate's real certifications listed below. Never omit it.

HARD RULES:
- Keep EVERY fact real. Never invent employers, titles, years, numbers, projects, or URLs. Only the profile + portfolio facts below may be used.
- PROOF, NOT PROMISES (USER'S #1 RULE): every bullet must describe something the candidate has ALREADY BUILT and SHIPPED ("Built", "Shipped", "Integrated", "Automated") that matches THIS job — never "I can", "I will", "I'm able to". Map each real build to the exact JD requirement it satisfies.
- LEVEL POSITIONING: the candidate is applying for INTERN / JUNIOR / ENTRY-LEVEL roles. Present him as a fast, self-driven builder with real shipped projects who is actively learning from senior engineers. NEVER claim senior-level experience, never inflate years, never say "led a team", never say "10+ years".
- LANGUAGE: The job description is in ${lang}. Write the ENTIRE tailored resume in ${lang} (the candidate's real facts are given in English — translate them faithfully). Do NOT mix languages.
- Plain text only: no markdown symbols, no hashtags, no tables, no decorative lines, no bullets with asterisks or dashes. Use clean lines. The word "Remote" (capital R, lowercase rest) may appear in project names; never write "REMOTE" in all-caps.
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
