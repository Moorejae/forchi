// Researcher: pulls real, current info about a company so the cover letter can
// prove the company is known (and the JD was read). Uses the existing web search.
const { searchWeb } = require("../../llm/webSearch");

async function researchCompany(company, title = "") {
  const queries = [
    `${company} company what they do products`,
    `${company} ${title ? title + " " : ""}news`,
  ];
  const blocks = [];
  const settled = await Promise.allSettled(queries.map((q) => searchWeb(q, 7000)));
  settled.forEach((s, i) => {
    if (s.status === "fulfilled" && s.value && s.value.results) {
      blocks.push(`[${queries[i]}] (via ${s.value.provider})\n${s.value.results}`);
    }
  });
  return blocks.join("\n\n").slice(0, 4000);
}

module.exports = { researchCompany };
