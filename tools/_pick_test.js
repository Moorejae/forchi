// Unit test for pickOption (avoid shell quoting issues).
const { pickOption } = require("../src/workflows/jobs/applyEngine");

const cases = [
  ["years bucket", "3", [{ label: "1-2 years" }, { label: "3-5 years" }, { label: "5+ years" }]],
  ["work auth neg", "Not authorized to work in-country; available for remote work worldwide",
    [{ label: "Yes, I am authorized" }, { label: "No, I am not authorized" }, { label: "I require visa sponsorship" }]],
  ["salary", "3500", [{ label: "Under $3,000" }, { label: "$3,000 - $4,000" }, { label: "$4,000+" }]],
  ["hear source", "Found via an AI job-search agent", [{ label: "LinkedIn" }, { label: "Referral" }, { label: "Other" }, { label: "Online" }]],
  ["clearance", "None (no security clearance)", [{ label: "Yes, I have clearance" }, { label: "No clearance" }, { label: "None" }]],
  ["work auth yes", "Authorized to work remotely", [{ label: "Yes" }, { label: "No" }]],
];

for (const [name, value, opts] of cases) {
  console.log(name.padEnd(16), "->", JSON.stringify(pickOption(opts, value)));
}
process.exit(0);
