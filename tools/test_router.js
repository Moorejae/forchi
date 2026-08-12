require("dotenv").config();
const { passesGate } = require("../src/router/gate");
const { extractPostIntent } = require("../src/router/extractor");

const TEST_MESSAGES = [
  // 1-5: Plain Chat (Should NOT pass gate or extractor)
  { text: "hello, how are you today?", expectedTrigger: false },
  { text: "what is Facebook?", expectedTrigger: false },
  { text: "explain LinkedIn to me", expectedTrigger: false },
  { text: "can you help me find the meaning of life?", expectedTrigger: false },
  { text: "how does the Hugging Face router work?", expectedTrigger: false },

  // 6-10: Incomplete Triggers (May pass gate regex, but MUST fail extractor hard validation)
  { text: "make a post", expectedTrigger: false }, // missing destination & content
  { text: "make a post to Facebook", expectedTrigger: false }, // missing content
  { text: "make a post about artificial intelligence", expectedTrigger: false }, // missing destination
  { text: "make a post to LinkedIn", expectedTrigger: false }, // missing content
  { text: "can you post something to Facebook and LinkedIn?", expectedTrigger: false }, // missing specific content

  // 11-16: Valid Complete Triggers (MUST pass gate regex AND extractor validation)
  {
    text: "make a post to Facebook about our new AI product release",
    expectedTrigger: true,
    expectedDests: ["facebook"],
  },
  {
    text: "make a post to LinkedIn about the future of remote work in tech",
    expectedTrigger: true,
    expectedDests: ["linkedin"],
  },
  {
    text: "make a post to Facebook and LinkedIn explaining how neural networks learn",
    expectedTrigger: true,
    expectedDests: ["facebook", "linkedin"],
  },
  {
    text: "make a post on LinkedIn about 5 tips for effective pair programming",
    expectedTrigger: true,
    expectedDests: ["linkedin"],
  },
  {
    text: "make a post to Facebook celebrating our company 10th anniversary",
    expectedTrigger: true,
    expectedDests: ["facebook"],
  }
];

async function runRouterTest() {
  console.log("==================================================");
  console.log("   RUNNING STAGE 2 ROUTER ISOLATION TEST SUITE");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_MESSAGES.length; i++) {
    const item = TEST_MESSAGES[i];
    const indexStr = `[${i + 1}/${TEST_MESSAGES.length}]`;
    console.log(`${indexStr} Message: "${item.text}"`);

    // Layer 1 Check
    const gatePassed = passesGate(item.text);
    console.log(`     Layer 1 Gate: ${gatePassed ? "PASSED (regex tripwire)" : "REJECTED (straight to chat)"}`);

    let finalIntent = { isPostTrigger: false, destinations: [], content: "" };

    if (gatePassed) {
      // Layer 2 Check
      finalIntent = await extractPostIntent(item.text);
      console.log(`     Layer 2 Extractor: isPostTrigger=${finalIntent.isPostTrigger}, destinations=${JSON.stringify(finalIntent.destinations)}, content="${finalIntent.content}"`);
    }

    const isMatch = finalIntent.isPostTrigger === item.expectedTrigger;

    if (isMatch) {
      console.log(`     Result: ✅ PASS\n`);
      passed++;
    } else {
      console.error(`     Result: ❌ FAIL (Expected isPostTrigger=${item.expectedTrigger}, got ${finalIntent.isPostTrigger})\n`);
      failed++;
    }
  }

  console.log("==================================================");
  console.log(`SUMMARY: Total=${TEST_MESSAGES.length} | Passed=${passed} | Failed=${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runRouterTest();
