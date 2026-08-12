/**
 * tools/run_social.js
 * Called by bot.py as a subprocess to run the social posting workflow.
 * Usage: node tools/run_social.js '{"destinations":["facebook"],"content":"..."}'
 * Outputs a JSON result line to stdout.
 */

const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const socialWorkflow = require("../src/workflows/social/index");

async function main() {
  const payload = process.argv[2];
  if (!payload) {
    console.log(JSON.stringify({ success: false, errorSummary: "No payload provided" }));
    process.exit(1);
  }

  let intent;
  try {
    intent = JSON.parse(payload);
  } catch (e) {
    console.log(JSON.stringify({ success: false, errorSummary: `Invalid JSON payload: ${e.message}` }));
    process.exit(1);
  }

  try {
    const result = await socialWorkflow.run({
      destinations: intent.destinations,
      content: intent.content,
      visualTopic: intent.visualTopic || null,
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    console.log(JSON.stringify({ success: false, failedPlatforms: intent.destinations, errorSummary: err.message }));
    process.exit(1);
  }
}

main();
