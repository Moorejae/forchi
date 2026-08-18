// Writer: generates the HUMAN-VOICE cover letter + screening answers.
// Grounded strictly in the real portfolio corpus + real company research.
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");
const { detectLanguage, translateText } = require("./lang");

// Not every job wants a cover letter — only write one when the posting asks for it
// (in English or the job's own language).
function jobNeedsCoverLetter(job) {
  const d = ((job.description || "") + " " + (job.title || "")).toLowerCase();
  if (/cover ?letter|please (include|attach|provide|write).{0,50}cover|\b(?:a|one|the) cover letter\b/.test(d)) return true;
  const lang = detectLanguage(job.description || "");
  const translated = {
    Polish: /listu? motywacyjn(ego|ego|ym|a|e)/,
    German: /anschreiben|bewerbungsschreiben/,
    Spanish: /carta de presentaci[oó]n/,
    French: /lettre de motivation/,
    Portuguese: /carta de apresenta[cç][aã]o/,
    Dutch: /motivatiebrief/,
    Italian: /lettera di presentazione|lettera motivazionale/,
  };
  return translated[lang] ? translated[lang].test(d) : false;
}

async function writeApplication({ job, companyResearch }) {
  const portfolioText = JSON.stringify(
    PORTFOLIO.map((p) => ({ project: p.project, role: p.role, years: p.years, url: p.url, facts: p.facts })),
    null, 1
  );
  // ALWAYS write a cover letter — it is the differentiator (proves the JD was
  // read + maps real builds to the company). The old gate only wrote one when
  // the JD explicitly asked, which left almost every letter empty.
  const withCoverLetter = true;
  const lang = detectLanguage(job.description || "");

  const coverInstructions = withCoverLetter
    ? `LANGUAGE REMINDER: The entire letter MUST be written in ${lang}. The template below is shown in English ONLY to show the structure — translate every line into ${lang}. Absolutely no English in the output.

COVER LETTER — this job wants a cover letter. Follow the template EXACTLY, in this order, filling each part with real, job-specific content:

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

RULES for the letter:
- Use 1-2 projects max, the most relevant to the job. Myzelva (https://myzelva.com) is the candidate's live prompt-engineering portfolio site — always include it as one of the projects. CloudVoid (https://cloudvoid.online) also has a live URL — prefer these two. ForChi and Flamchi are live 24/7 production Telegram bots with no web URL — say "live in production on Telegram" instead of a URL.
- If the hiring manager's name is unknown, use "Hello," — never invent a name.
- Sign with ONLY "Best regards," — no name and no links after it.
- The reason line and the P.S. MUST reference this specific job and company (prove you read the JD and know them).
- Replace every [bracket] with real content. Keep the whole letter SHORT.`
    : `COVER LETTER — THIS JOB DOES NOT REQUIRE A COVER LETTER. Do NOT write one. Return "coverLetter": "" (empty string). Only answer the job's screening questions below (and only if the JD actually contains any).`;

  const prompt = `You are preparing a JOB APPLICATION for ${PROFILE.name} ("Victor"), IN HIS VOICE.

VOICE & FORMAT RULES (CRITICAL):
- Natural, confident, first-person. Reads like he typed it in five minutes. Contractions are fine.
- NO AI spacing: no dash characters (— or -), no hashes (#), no stars (* or **), no bullet markers, no markdown. Plain clean lines only.
- SHORT. Never pad.
- NEVER invent facts, projects, URLs, quotes, or numbers that are not in the real data below.
- LANGUAGE: The job description is in ${lang}. Write the cover letter and screening answers ENTIRELY in ${lang} (the candidate's real facts are given in English — translate them faithfully). Do NOT mix languages.

REAL CANDIDATE DATA (use ONLY this):
- Title: ${PROFILE.title}
- Summary: ${PROFILE.summary}
- Languages: ${PROFILE.languages.join(", ")} — English is professional/fluent, Igbo is native; do NOT claim fluency in any other language.
- Work authorization: "${PROFILE.workAuthorization}" — answer authorization/eligible-to-work questions honestly (no in-country authorization; available for remote work worldwide).
- Security clearance: "${PROFILE.securityClearance}" — answer clearance questions honestly as none.
- Salary expectation (if asked for salary, answer with this — NEVER above $5,000/month): "${PROFILE.salaryExpectation || "negotiable, under $5,000/month"}"
- Testimonial (if empty, omit the quote line — never invent one): "${PROFILE.testimonial}"
- Real projects: ${portfolioText}

JOB (mirror its actual tech and required skills):
- Company: ${job.company}
- Title: ${job.title}
- Description: ${(job.description || "").slice(0, 6000)}

COMPANY RESEARCH (real, from web search; if empty do NOT invent company facts):
${companyResearch || "(no research available)"}

${coverInstructions}

Also extract the screening questions from the JD and write short, honest, natural answers in the same voice (if the JD has none, answers = []).

Return JSON ONLY:
{"coverLetter": "string — empty when no cover letter is required", "answers": [{"question": "string", "answer": "short natural answer"}]}

REMINDER BEFORE ANSWERING: if the job is not in English, "coverLetter" and every "answer" MUST be entirely in ${lang}. Never output English for a non-English job.`;

  try {
    const raw = await generate(prompt, { type: "object", maxTokens: 1200 });
    const p = JSON.parse(raw);
    let coverLetter = p.coverLetter || "";
    let answers = Array.isArray(p.answers) ? p.answers : [];
    // Hard guarantee: for non-English jobs, translate the output into the job's language.
    if (lang !== "English") {
      coverLetter = await translateText(coverLetter, lang);
      answers = await Promise.all(answers.map(async (a) => ({ ...a, answer: await translateText(a.answer, lang) })));
    }
    return { coverLetter, answers };
  } catch (e) {
    console.warn("[Jobs] Writer failed:", e.message);
    return { coverLetter: "", answers: [] };
  }
}

module.exports = { writeApplication, jobNeedsCoverLetter };
