// Demo: language-aware resume + cover letter for a non-English (Polish) job posting.
// Usage: node tools/_lang_demo.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { writeApplication, jobNeedsCoverLetter } = require("../src/workflows/jobs/writer");
const { tailorResume } = require("../src/workflows/jobs/tailor");
const { getResumeBuffer } = require("../src/workflows/jobs/applyEngine");

// Sample REAL Polish job posting (remote, mentions cover letter -> exercises both paths).
const job = {
  source: "greenhouse",
  company: "Przykładowa AI Sp. z o.o.",
  title: "Inżynier Backend (Node.js) — praca zdalna",
  location: "Remote (Polska / Europa)",
  description: `Dołącz do naszego zespołu w Warszawie — praca w pełni zdalna w całej Europie. Szukamy inżyniera backendu z doświadczeniem w Node.js, TypeScript i PostgreSQL.

Odpowiedzialności:
- projektowanie i utrzymywanie API REST dla systemów AI,
- integracje z modelami LLM i agentami (RAG),
- automatyzacja procesów i pipeline'ów CI/CD,
- praca w chmurze (AWS / GCP) z Docker i Kubernetes.

Wymagania: min. 3 lata doświadczenia z Node.js, znajomość Docker, Kubernetes, PostgreSQL. Mile widziane: doświadczenie z AI/LLM, agentami, multi-agent orchestration.

Oferujemy: wynagrodzenie do 20 000 PLN/mies., praca zdalna, elastyczny czas pracy, budżet szkoleniowy.

Prosimy o dołączenie CV oraz listu motywacyjnego, w którym opiszesz swoje projekty i dlaczego pasujesz do naszego zespołu.`,
};

(async () => {
  console.log("JOB (Polish):", job.title);
  console.log("needs cover letter:", jobNeedsCoverLetter(job));

  const app = await writeApplication({ job, companyResearch: "" });
  console.log("\n" + "=".repeat(16), "COVER LETTER (Polish)", "=".repeat(16));
  console.log(app.coverLetter || "(no cover letter generated)");
  if (app.answers && app.answers.length) {
    console.log("\n--- ANSWERS ---");
    for (const a of app.answers) console.log(`Q: ${a.question}\nA: ${a.answer}\n`);
  }
  // Write outputs as UTF-8 files so we can verify the real bytes/language.
  fs.writeFileSync(path.join("C:\\Users\\hp\\Downloads", "ForChi_CoverLetter_PL.txt"), app.coverLetter || "", "utf8");

  const tailored = await tailorResume(job);
  console.log("=".repeat(16), "TAILORED RESUME (Polish)", "=".repeat(16));
  console.log(tailored);

  // Render the Polish resume to PDF too (Carlito covers Latin/CE chars).
  const buf = await getResumeBuffer(tailored);
  const out = path.join("C:\\Users\\hp\\Downloads", "ForChi_Resume_PL_Demo.pdf");
  fs.writeFileSync(out, buf);
  console.log(`\nPDF written: ${out} (${(buf.length / 1024).toFixed(1)} KB)`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
