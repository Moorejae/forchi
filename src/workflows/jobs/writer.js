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

COVER LETTER — this job wants a cover letter. Follow the template EXACTLY, in this order, filling each part with real, job-specific content. THE WHOLE LETTER IS PROOF, NOT PROMISES: every line describes something ALREADY BUILT and SHIPPED that is DIRECTLY RELATED to what this job's description asks for. Never say "I can do X" — say "I built X". Never say "I will bring X" — say "here is X I already built". The employer is not reading for what you could do; they are reading for what you have done that matches what they need.

Hello [Hiring Manager Name],
I'm applying for the [Job Title] role at [Company] because you are looking for someone who [shortest possible echo of the JD's #1 requirement — one clause]. I've built exactly that, in production, and I'd love to bring the same results to your team.
What I've actually built (all live, all related to this role):
[Project 1]: [1-2 sentence engineering description, more technical detail — mention the exact tools/APIs/stack that mirror the JD]. Live here: [URL only if the project has a real URL]
[Project 2]: [1-2 sentence engineering description, more technical detail]. Live here: [URL only if the project has a real URL]
[Project 3, ONLY if it is directly relevant and has a real URL — e.g. the YouTube automation workflow, live at https://www.youtube.com/@sirxlud]: [1-2 sentence technical description]
[Only if the testimonial above is non-empty: Feedback from past collaborators/clients: "[the real quote]"]
In short: I have done [the specific thing the JD wants], at [scale/detail relevant to the role], end-to-end. I'm applying at the [intern/junior] level because I ship fast and learn faster, and I want to do that inside a strong team.
We can set up a brief call to discuss how what I've already built maps onto your current stack.
Best regards,
P.S. [a light, professional human touch — MUST be different for every job, tied to THIS job's description and company]

RULES for the letter:
- Use 2-3 projects max, ONLY ones directly relevant to the job. Always prefer projects with a live URL: Myzelva (https://myzelva.com), CloudVoid (https://cloudvoid.online), and the YouTube automation channel (https://www.youtube.com/@sirxlud). ForChi and Flamchi are live 24/7 production Telegram bots with no web URL — say "live in production on Telegram" instead of a URL.
- MAP every project to the JD: if the job is about cloud security, describe the CloudVoid encrypted 'Riverbed' envelope (P-256 ECDH + AES-256-GCM) and iptables/Cloudflare WAF lockdown; if it's about AI integration, describe ForChi's LLM failover and trigger-based agent; if it's workflow automation, describe the ForChi autonomous pipelines (YouTube 2 videos/day, job auto-apply); if it's API integration, list the APIs actually wired (YouTube Data API v3, Facebook Graph, LinkedIn, Telegram, ParaSwap, Alchemy RPCs, ATS APIs). Mirror the JD's exact vocabulary.
- If the hiring manager's name is unknown, use "Hello," — never invent a name.
- Sign with ONLY "Best regards," — no name and no links after it.
- The reason line, the "In short" line, and the P.S. MUST reference this specific job and company (prove you read the JD and know them).
- Replace every [bracket] with real content. Keep the whole letter SHORT — 3 short paragraphs of proof, nothing more.`
    : `COVER LETTER — THIS JOB DOES NOT REQUIRE A COVER LETTER. Do NOT write one. Return "coverLetter": "" (empty string). Only answer the job's screening questions below (and only if the JD actually contains any).`;

  const prompt = `You are preparing a JOB APPLICATION for ${PROFILE.name} ("Victor"), IN HIS VOICE.

PROOF, NOT PROMISES (USER'S #1 RULE): Hiring managers don't care what the candidate CAN do — they care what he HAS DONE that matches what they want. EVERY claim must be a real shipped build from the data below, phrased as "I built / I shipped / I run", and mapped to THIS job's requirements. NEVER write "I can", "I will bring", "I'm confident I could". If a job requirement is not covered by a real build below, do not pretend it is.

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
- Company website: ${job.companyUrl || "(none provided — do not invent one)"}
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
