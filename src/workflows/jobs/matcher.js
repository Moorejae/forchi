// Matcher: Gemini scores each discovered job against the real profile + portfolio.
const { generate } = require("../../llm/provider");
const { PROFILE } = require("./profile");
const { PORTFOLIO } = require("./portfolio");

const MIN_SCORE = Number(process.env.JOBS_MIN_SCORE || 70);

// Location filter: remote roles always OK; hybrid/onsite ONLY with visa/relocation sponsorship.
// Handles negations like "we do NOT offer sponsorship" / "no visa sponsorship".
function isLocationAllowed(job) {
  const loc = ((job.location || "") + " " + (job.description || "")).toLowerCase();
  if (/\b(remote|anywhere|worldwide|global|distributed|work from home|fully remote|100% remote)\b/.test(loc)) {
    return true;
  }
  const sponsored = /visa\s*sponsor|work authorization\s*sponsor|\bsponsorship\b|relocat/.test(loc);
  if (!sponsored) return false;
  // Negation can come BEFORE ("we do NOT offer sponsorship") or AFTER ("sponsorship NOT available").
  const negBefore = /\b(no|not|does not|do not|won'?t|cannot|can'?t|unable to|without)\b[^.!?]{0,80}\b(sponsor|visa|relocat)/.test(loc);
  const negAfter = /\b(sponsor|visa|relocat)[^.!?]{0,60}\b(no|not|unavailable|unable|isn'?t|aren'?t)\b/.test(loc);
  return !(negBefore || negAfter);
}

// Region block (user rule): skip India-located roles — low pay, rough work
// environment. Matches on location ("Remote (Bangalore, India)", city names)
// plus well-known Indian staffing/outsourcing firms.
const BLOCK_INDIA = (process.env.JOBS_BLOCK_INDIA || "true").toLowerCase() !== "false";
const INDIA_CITIES = [
  "bengaluru", "bangalore", "mumbai", "bombay", "delhi", "new delhi", "hyderabad",
  "pune", "chennai", "madras", "gurgaon", "noida", "kolkata", "calcutta", "ahmedabad",
  "kochi", "jaipur", "indore", "chandigarh", "nagpur", "lucknow", "surat", "thiruvananthapuram",
];
const INDIA_COMPANIES = [
  "tata consultancy", " tcs ", "infosys", "wipro", "hcl ", "cognizant", "tech mahindra",
  "persistent systems", "mphasis", "ltimindtree", "ust global", "zensar", "hexaware",
  "coforge", "cyient", "tata", "accenture india", "capgemini india",
];

function isIndianJob(job) {
  if (!BLOCK_INDIA) return false;
  const loc = (job.location || "").toLowerCase();
  const comp = (job.company || "").toLowerCase();
  if (/\bindia\b/.test(loc)) return true;
  if (INDIA_CITIES.some((c) => new RegExp(`\\b${c}\\b`).test(loc))) return true;
  if (INDIA_COMPANIES.some((c) => comp.includes(c.trim()))) return true;
  return false;
}

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
- LEVEL HARD RULE: the candidate is positioning for INTERN / JUNIOR / INTERMEDIATE roles. Roles titled or described as 'Senior', 'Staff', 'Principal', 'Lead', 'Manager', or that require 5+ years of professional experience, MUST score low and set apply=false. Intern, junior, intermediate and entry-level roles are strongly preferred and should score well — the candidate's real shipped projects are the proof, not years.
- LOCATION HARD RULE: the candidate only wants REMOTE roles. If the role is hybrid or onsite, only set apply=true when the posting explicitly offers visa / work-authorization / relocation sponsorship (look for "visa sponsorship", "sponsorship available", "work authorization sponsorship", "relocation support"). Otherwise set apply=false with reason mentioning "not remote / no visa sponsorship".
- PREFERRED REGIONS: Poland, Europe, Australia, New Zealand, North America, South America, Israel. Roles in these regions (or fully remote) are strongly preferred; roles elsewhere are lower priority.
- Job descriptions may be written in languages other than English — that is fine, evaluate them normally.
- Remote/cloud/AI/LLM/AI-integration/AI-automation/automation/backend roles should score well given his profile. AI INTEGRATION and AI AUTOMATION roles (integrating LLMs into products, building agent pipelines, workflow/trigger-based automation, prompt/function-calling orchestration) are squarely in scope — his real projects (ForChi, CloudVoid, Flamchi/Odonata) are exactly this.
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

module.exports = { scoreJob, isLocationAllowed, isIndianJob, BLOCK_INDIA, MIN_SCORE };
