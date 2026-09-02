// Rebuild the BASE resume PDF from the updated PROFILE (direct-summary format,
// junior/intermediate positioning). Backs up the old PDF first.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { PROFILE } = require(path.join(__dirname, "..", "src", "workflows", "jobs", "profile"));
const { getResumeBuffer } = require(path.join(__dirname, "..", "src", "workflows", "jobs", "applyEngine"));

const RESUME = path.join(__dirname, "..", "data", "resume", "Agu_Victor_Chiedozie_Resum.pdf");

function buildBaseText() {
  const lines = [];
  // USER DIRECTIVE (2026-09-02): the base resume uses the Cloud & AI Systems
  // Engineer version (headline + summary), drops company/title/dates from the
  // body (handled in the ATS form), and writes "Remote" not "REMOTE".
  const version = (PROFILE.resumeVersions || []).find((v) => v.key === "cloud-ai") || {};
  // HEADER
  lines.push(PROFILE.name);
  lines.push(version.headline || PROFILE.title);
  lines.push(`WAT (GMT+1) | ${PROFILE.email} | ${PROFILE.phone} | ${PROFILE.linkedin} | ${PROFILE.github}`);
  // SUMMARY
  lines.push("");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push(version.summary || PROFILE.summary);
  // SKILLS
  lines.push("");
  lines.push("KEY SKILLS");
  const skillGroups = [];
  for (const [group, items] of Object.entries(PROFILE.skills)) {
    skillGroups.push(items.join(", "));
  }
  lines.push(skillGroups.join("  |  "));
  // PROJECTS + EXPERIENCE (project name + bullets only — no company/role/dates line)
  lines.push("");
  lines.push("TECHNICAL PROJECTS & EXPERIENCE");
  for (const e of PROFILE.experience) {
    // Project name = company field, minus any URL/dash decoration.
    const name = e.company ? e.company.split(" — ")[0].replace(/\s*\([^)]*\)\s*$/, "").trim() : e.role;
    lines.push(name);
    for (const b of e.bullets) lines.push(`- ${b}`);
    lines.push("");
  }
  // CERTIFICATIONS
  lines.push("CERTIFICATIONS");
  for (const c of PROFILE.certifications) lines.push(`- ${c}`);
  return lines.join("\n");
}

async function main() {
  const text = buildBaseText();
  // maxPages: 2 — the BASE resume carries the FULL real work history legibly
  // (2 pages is standard for a full background; per-job tailored resumes still
  // render at maxPages: 1 via the normal apply path).
  const buf = await getResumeBuffer(text, { maxPages: 2 });
  if (fs.existsSync(RESUME)) {
    fs.renameSync(RESUME, RESUME.replace(".pdf", "_old.pdf"));
    console.log("backed up old resume ->", path.basename(RESUME.replace(".pdf", "_old.pdf")));
  }
  fs.writeFileSync(RESUME, buf);
  console.log("wrote new base resume:", RESUME, buf.length, "bytes");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
