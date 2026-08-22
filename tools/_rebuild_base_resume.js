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
  // HEADER
  lines.push(PROFILE.name);
  lines.push(PROFILE.title);
  lines.push(`WAT (GMT+1) | ${PROFILE.email} | ${PROFILE.phone} | ${PROFILE.linkedin} | ${PROFILE.github}`);
  // SUMMARY
  lines.push("");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push(PROFILE.summary);
  // SKILLS
  lines.push("");
  lines.push("KEY SKILLS");
  const skillGroups = [];
  for (const [group, items] of Object.entries(PROFILE.skills)) {
    skillGroups.push(items.join(", "));
  }
  lines.push(skillGroups.join("  |  "));
  // PROJECTS + EXPERIENCE (direct summary format: role | company | years + bullets)
  lines.push("");
  lines.push("TECHNICAL PROJECTS & EXPERIENCE");
  for (const e of PROFILE.experience) {
    lines.push(`${e.role} | ${e.company} | REMOTE`);
    lines.push(e.years);
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
  const buf = await getResumeBuffer(text);
  if (fs.existsSync(RESUME)) {
    fs.renameSync(RESUME, RESUME.replace(".pdf", "_old.pdf"));
    console.log("backed up old resume ->", path.basename(RESUME.replace(".pdf", "_old.pdf")));
  }
  fs.writeFileSync(RESUME, buf);
  console.log("wrote new base resume:", RESUME, buf.length, "bytes");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
