// Matcher: Gemini scores each discovered job against the real profile + portfolio.
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");

const MIN_SCORE = Number(process.env.JOBS_MIN_SCORE || 70);

function scoreJob(job) {
  const prompt = `You are a rigorous job-match evaluator. Decide whether this candidate should apply to a job.

CANDIDATE PROFILE (all real):
- Title: ${PROFILE.title}
- Summary: ${PROFILE.summary}
- Skills: ${JSON.stringify(PROFILE.skills)}
- Target roles: ${PROFILE.targetRoles.join(", ")}
- Real projects: ${PORTFOLIO.map((p) => `${p.project} — ${p.facts[0]}`).join(" | ")}

JOB:
- Company: ${job.company}
- Title: ${job.title}
- Location: ${job.location || "n/a"}
- Salary: ${job.salary || "n/a"}
- Description: ${(job.description || "").slice(0, 5000)}

RULES:
- Score 0-100 for how well the candidate's REAL skills and projects match.
- Be strict about hard requirements: if the job demands something the candidate clearly lacks (e.g. 10+ years in a very specific senior role, a specific required certification he doesn't have), drop the score and set apply=false.
- Remote/cloud/AI/automation/backend roles should score well given his profile.
- missing_skills must be honest and specific.

Return JSON ONLY, no commentary:
{"score": number, "apply": boolean, "matched_skills": [string], "missing_skills": [string], "reason": "1-2 sentences"}`;

  return generate(prompt, { type: "object" })
    .then((raw) => {
      try {
        const p = JSON.parse(raw);
        const score = Math.max(0, Math.min(100, Number(p.score) || 0));
        return {
          score,
          apply: !!(p.apply && score >= MIN_SCORE),
          matched_skills: Array.isArray(p.matched_skills) ? p.matched_skills : [],
          missing_skills: Array.isArray(p.missing_skills) ? p.missing_skills : [],
          reason: p.reason || "",
        };
      } catch {
        return { score: 0, apply: false, matched_skills: [], missing_skills: [], reason: "parse error" };
      }
    })
    .catch((e) => {
      console.warn("[Jobs] Matcher failed:", e.message);
      return { score: 0, apply: false, matched_skills: [], missing_skills: [], reason: e.message };
    });
}

module.exports = { scoreJob, MIN_SCORE };
