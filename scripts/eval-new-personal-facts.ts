import { conversationLogger } from "../src/server/data/conversation-logger";
import { processConversation } from "../src/server/mastra/agents/initial-agent";
import type { Conversation } from "../src/server/mastra/types";

const userId = process.argv[2] || "li2897283405@gmail.com";

type EvalCase = {
  id: string;
  q: string;
  expectedRef: string;
  shouldMention?: string[];
};

const cases: EvalCase[] = [
  {
    id: "piano-now",
    q: "Can you play piano now?",
    expectedRef: "xiang-update:2026-05:piano-learning",
    shouldMention: ["forgot"],
  },
  {
    id: "instrument-history",
    q: "Did you play any musical instrument in school?",
    expectedRef: "xiang-update:2026-05:music-instruments",
    shouldMention: ["saxophone", "band"],
  },
  {
    id: "car-model",
    q: "What car do you drive?",
    expectedRef: "xiang-update:2026-05:driving-car",
    shouldMention: ["Honda", "Civic"],
  },
  {
    id: "car-price",
    q: "What is the most expensive thing you bought?",
    expectedRef: "xiang-update:2026-05:driving-car",
    shouldMention: ["Honda", "45"],
  },
  {
    id: "sister-age-gap",
    q: "Do you have any siblings? How much older is your sister?",
    expectedRef: "xiang-update:2026-05:family-current-details",
    shouldMention: ["nine"],
  },
  {
    id: "sister-married",
    q: "Is your sister married?",
    expectedRef: "xiang-update:2026-05:family-current-details",
    shouldMention: ["2025", "daughter"],
  },
  {
    id: "mother-partner",
    q: "Who lives with your mother now?",
    expectedRef: "xiang-update:2026-05:family-current-details",
    shouldMention: ["Zhao"],
  },
];

let passed = 0;

for (const test of cases) {
  const searchResults = conversationLogger.searchPersonalMemoriesHybrid(userId, test.q, 5);
  const refs = searchResults.map((memory) => memory.sourceRef || `id:${memory.id}`);
  const top3Ok = refs.slice(0, 3).includes(test.expectedRef);
  const relevantMemory = conversationLogger.getRelevantPersonalMemoryContext(userId, test.q, 5);
  const conversation: Conversation = [{ type: "transcript", text: test.q, timestamp: Date.now() }];
  const response = await processConversation(conversation, "high", undefined, "english", "", "", relevantMemory);
  const output = response.type === "insight" ? response.output : "";
  const outputOk = (test.shouldMention ?? []).every((term) => output.toLowerCase().includes(term.toLowerCase()));

  if (top3Ok && outputOk) passed += 1;

  console.log(`\n[${top3Ok && outputOk ? "PASS" : "CHECK"}] ${test.id}`);
  console.log(`Q: ${test.q}`);
  console.log(`Expected top3: ${test.expectedRef}`);
  console.log(`Top refs: ${refs.slice(0, 5).join(" | ") || "none"}`);
  console.log(`Output: ${output}`);
  if (!top3Ok) console.log(`Issue: expected ref not in top3`);
  if (!outputOk) console.log(`Issue: output missing one of ${test.shouldMention?.join(", ")}`);
}

console.log(`\nNEW_PERSONAL_FACTS_EVAL passed=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
