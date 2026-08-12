require("dotenv").config();
const { passesGate } = require("../src/router/gate");
const { PostIntentSchema } = require("../src/router/extractor");

const TEST_MESSAGES = [
  // 1-5: Plain Chat (Final Trigger MUST be false)
  { text: "hello, how are you today?", expectedGate: false, expectedTrigger: false },
  { text: "what is Facebook?", expectedGate: true, mockResult: { isPostTrigger: false, destinations: [], content: "" }, expectedTrigger: false },
  { text: "explain LinkedIn to me", expectedGate: true, mockResult: { isPostTrigger: false, destinations: [], content: "" }, expectedTrigger: false },
  { text: "can you help me find the meaning of life?", expectedGate: false, expectedTrigger: false },
  { text: "how does the Hugging Face router work?", expectedGate: false, expectedTrigger: false },

  // 6-10: Incomplete Triggers (Pass gate regex, but fail hard validation)
  { text: "make a post", expectedGate: true, mockResult: { isPostTrigger: true, destinations: [], content: "" }, expectedTrigger: false },
  { text: "make a Facebook post", expectedGate: true, mockResult: { isPostTrigger: true, destinations: ["facebook"], content: "" }, expectedTrigger: false },
  { text: "make a post about artificial intelligence", expectedGate: true, mockResult: { isPostTrigger: true, destinations: [], content: "artificial intelligence" }, expectedTrigger: false },
  { text: "make a post to LinkedIn", expectedGate: true, mockResult: { isPostTrigger: true, destinations: ["linkedin"], content: "" }, expectedTrigger: false },
  { text: "can you post something to Facebook and LinkedIn?", expectedGate: true, mockResult: { isPostTrigger: false, destinations: [], content: "" }, expectedTrigger: false },

  // 11-15: Valid Complete Triggers (Pass gate AND extractor validation)
  {
    text: "make a Facebook post about forgiveness and honor",
    expectedGate: true,
    mockResult: { isPostTrigger: true, destinations: ["facebook"], content: "forgiveness and honor" },
    expectedTrigger: true
  },
  {
    text: "make a post to LinkedIn about the future of remote work in tech",
    expectedGate: true,
    mockResult: { isPostTrigger: true, destinations: ["linkedin"], content: "the future of remote work in tech" },
    expectedTrigger: true
  },
  {
    text: "make a post to Facebook and LinkedIn explaining how neural networks learn",
    expectedGate: true,
    mockResult: { isPostTrigger: true, destinations: ["facebook", "linkedin"], content: "explaining how neural networks learn" },
    expectedTrigger: true
  },
  {
    text: "make a post on LinkedIn about 5 tips for effective pair programming",
    expectedGate: true,
    mockResult: { isPostTrigger: true, destinations: ["linkedin"], content: "5 tips for effective pair programming" },
    expectedTrigger: true
  },
  {
    text: "make a post to Facebook celebrating our company 10th anniversary",
    expectedGate: true,
    mockResult: { isPostTrigger: true, destinations: ["facebook"], content: "celebrating our company 10th anniversary" },
    expectedTrigger: true
  }
];

function applyHardValidation(result) {
  const validated = PostIntentSchema.safeParse(result);
  if (!validated.success) return { isPostTrigger: false, destinations: [], content: "" };
  const data = validated.data;
  if (!data.destinations || !data.destinations.length || !data.content || !data.content.trim()) {
    return { ...data, isPostTrigger: false };
  }
  return data;
}

function runMockValidationTest() {
  console.log("==================================================");
  console.log("  STRICT STAGE 2 MOCK & GATE VALIDATION SUITE");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_MESSAGES.length; i++) {
    const item = TEST_MESSAGES[i];
    const gatePassed = passesGate(item.text);

    let finalTrigger = false;
    if (gatePassed) {
      const mockRes = item.mockResult || { isPostTrigger: false, destinations: [], content: "" };
      const validated = applyHardValidation(mockRes);
      finalTrigger = validated.isPostTrigger;
    }

    const expectedTrigger = item.expectedTrigger || false;
    const isPass = gatePassed === item.expectedGate && finalTrigger === expectedTrigger;

    console.log(`[${i + 1}/${TEST_MESSAGES.length}] "${item.text}"`);
    console.log(`     Gate: ${gatePassed} (Expected: ${item.expectedGate}) | Final Trigger: ${finalTrigger} (Expected: ${expectedTrigger})`);

    if (isPass) {
      console.log(`     Result: ✅ PASS\n`);
      passed++;
    } else {
      console.log(`     Result: ❌ FAIL\n`);
      failed++;
    }
  }

  console.log("==================================================");
  console.log(`RESULT: ${passed}/${TEST_MESSAGES.length} PASSED`);
  console.log("==================================================");

  if (failed > 0) process.exit(1);
}

runMockValidationTest();
