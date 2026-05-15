import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { Action, AgentType, type Conversation, type AgentResponse } from "../types";
import type { EventMemorySnapshot } from "../../memory/event-memory";

const sayNextInstructions = `You are SayNext, Xiang's real-time conversation helper.

Output one short text that is useful on the glasses right now. It can be:
- a sayable reply when someone asks Xiang something
- a short knowledge supplement when someone is explaining a concept
- a brief acknowledgement or clarification when that is all that helps

Core rules:
- Prioritize the latest transcript. Older context is only background.
- Do not repeat or summarize the speaker's words
- Use personal background only when the question asks about Xiang's experience, project, school, work, preference, or plan.
- Do not invent Xiang's personal experience or claim senior work experience.
- For professional, technical, or academic topics, be precise and knowledgeable. Use correct domain terms when useful.
- For technical questions, answer the concept first with a useful principle, mechanism, trade-off, tool, or debugging step.
- For lecture/explanation context, provide a deeper useful note, concrete example, trade-off, or smart question. Do not write it as fake small talk.
- For casual chat, sound like a normal student: simple, modest, slightly imperfect, not essay-like, not corporate.
- Avoid mission statements, self-praise, resume wording, and stiff openings like "Today I plan to..."
- Do not include labels, analysis, options, translations, or "you can say".

Style:
- short, natural, easy to say or read, Sound like a real person talking, not a written answer
- usually 1 sentence; 2-4 short sentences are okay for professional or academic questions when depth is needed
- okay to use "honestly", "probably", "kind of", "a bit", "not really", "I guess", "like".
-Avoid sounding too confident, too perfect, or too prepared.

- English by default; Chinese only when the output language setting is Chinese


Return only valid JSON in this exact shape:
{"type":"insight","reasoning":"brief private reason","timestamp":0,"output":"the short useful text to show","confidence":0.8,"metadata":{"agentType":"Initial"}}

The output field is the only text that will be shown on the glasses.`;

const MODEL_NAME = "gpt-4.1-mini";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const PROFILE_VERSION = "3.0";
const ACTIVE_MODEL_NAME = LLM_PROVIDER === "ollama" ? OLLAMA_MODEL : MODEL_NAME;

export const initialAgentHigh = new Agent({
  name: "SayNextAgentHigh",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions
});

export const initialAgentMedium = new Agent({
  name: "SayNextAgentMedium",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions
});

export const initialAgentLow = new Agent({
  name: "SayNextAgentLow",
  model: openai(MODEL_NAME),
  instructions: sayNextInstructions
});

export function sanitizeSayNextOutput(text: string): string {
  let cleaned = String(text ?? "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (/^\s*\{/.test(cleaned)) {
    const outputField = extractOutputField(cleaned);
    if (outputField) {
      cleaned = outputField;
    } else {
      return "Sorry, could you say that again?";
    }
  }

  cleaned = cleaned
    .replace(/\r\n/g, "\n")
    .replace(/\b(?:option|version|response)\s*\d+\s*[:.)-]/gi, "\n")
    .replace(/\b(?:option|version|response)\s*[A-Z]\s*[:.)-]/gi, "\n");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstUsefulLine = lines.find((line) => {
    return !/^(scene|analysis|reasoning|explanation|note|context)\s*[:-]/i.test(line);
  }) ?? lines[0] ?? "";

  cleaned = firstUsefulLine
    .replace(/^\s*(?:[-*]+|\d+[.)]|[A-Za-z][.)])\s*/g, "")
    .replace(/^\s*(?:(?:you\s+can\s+say|you\s+could\s+say|say|direct\s+answer|answer|reply|response|suggested\s+reply)\s*[:-]\s*)+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();

  if (!cleaned) {
    return "Sorry, could you say that again?";
  }

  if (/^(sure|okay|ok|yes|yeah|thank you|thanks)[.!]*$/i.test(cleaned)) {
    return "Sure, could you repeat the full question?";
  }

  if (cleaned.length > 360) {
    const firstSentence = cleaned.match(/^.{1,360}?[.!?](?:\s|$)/)?.[0]?.trim();
    cleaned = firstSentence || `${cleaned.slice(0, 357).trim()}...`;
  }

  return cleaned;
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function extractOutputField(text: string): string | null {
  const match = text.match(/"output"\s*:\s*"((?:\\.|[^"\\])*)/i);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(`"${match[1].replace(/\\?$/, "")}"`);
  } catch {
    return match[1].replace(/\\"/g, '"').trim();
  }
}

async function generateWithOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: `${sayNextInstructions}\n\nDo not return JSON for Ollama. Return only the short useful text to show on the glasses.`,
      prompt: `${prompt}\n\nReturn only one short useful text. Use 2-4 short sentences if a professional or academic question needs depth. No JSON. No labels. No reasoning.`,
      stream: false,
      options: {
        temperature: 0.35,
        top_p: 0.9,
        num_ctx: 4096,
        num_predict: 120,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "");
}

function createInsight(output: string, reasoning: string, timestamp: number, confidence = 0.9): AgentResponse {
  return {
    type: Action.INSIGHT,
    reasoning,
    timestamp,
    output: sanitizeSayNextOutput(output),
    confidence,
    metadata: {
      agentType: AgentType.Initial,
      agentInput: {
        model: ACTIVE_MODEL_NAME,
        profileVersion: PROFILE_VERSION,
        retrievedSampleIds: [],
      }
    }
  };
}

function getLatestTranscript(conversation: Conversation): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const item = conversation[i];
    if (item.type === 'transcript') {
      return item.text;
    }
  }

  return "";
}

export type OutputLanguage = "english" | "chinese";

type PromptMode = "casual" | "classroom" | "interview" | "technical" | "service" | "general";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /[?£¿]\s*$/.test(normalized) || /^(what|why|how|when|where|who|which|can|could|would|do|does|did|is|are|have|has|tell me|describe|explain)\b/.test(normalized);
}

function detectPromptMode(latestTranscript: string, eventMemory?: EventMemorySnapshot): PromptMode {
  const text = `${latestTranscript} ${eventMemory?.scene ?? ""} ${eventMemory?.title ?? ""} ${eventMemory?.summary ?? ""}`.toLowerCase();

  if (includesAny(text, ["interview", "candidate", "hire", "resume", "tell me about yourself", "why should we hire", "position", "role"])) {
    return "interview";
  }

  if (includesAny(text, [
    "classroom",
    "lecture",
    "professor",
    "course",
    "assignment",
    "academic",
    "algorithm",
    "theorem",
    "math",
    "proof",
    "model",
    "training",
    "loss",
    "gradient",
    "backprop",
    "supervised learning",
    "unsupervised learning",
    "neural network",
    "deep learning",
    "machine learning",
    "data structure",
    "distributed system",
    "consistency",
    "cap theorem",
    "cloud architecting",
    "availability zone",
    "lambda",
    "dynamodb",
    "scalability",
    "elasticity",
  ])) {
    return "classroom";
  }

  if (includesAny(text, [
    "api",
    "backend",
    "frontend",
    "cloud",
    "database",
    "debug",
    "architecture",
    "security",
    "aws",
    "firebase",
    "react",
    "serverless",
    "kubernetes",
    "sagemaker",
    "machine learning",
    "deep learning",
    "ai",
    "code",
  ])) {
    return "technical";
  }

  if (includesAny(text, ["front desk", "maintenance", "advisor", "insurance", "bank", "policy", "residence", "deadline", "appointment"])) {
    return "service";
  }

  if (includesAny(text, ["weekend", "free time", "music", "game", "food", "anime", "friend", "weather", "holiday", "mountain", "morning", "day going"])) {
    return "casual";
  }

  return "general";
}

function buildCompactXiangProfile(mode: PromptMode): string {
  const base = [
    "Name: Xiang Li.",
    "Identity: Chinese international MACS student at Dalhousie in Halifax.",
    "Voice: simple spoken English, natural, modest, casual , slightly imperfect is okay.",
    "Avoid: polished essay tone, resume wording, self-praise, fake confidence, corporate words, overexplaining.",
    "Useful words: honestly, probably, kind of, mostly, a bit, not really, I think, maybe.",
    "Professional/academic topics: be expert, accurate, and specific. Do not make the answer casual if the topic needs rigor.",
    "Privacy: do not overshare sensitive details unless the context clearly needs it.",
  ];

  const modeProfiles: Record<PromptMode, string[]> = {
    casual: [
      "Casual life: homebody, small circle, likes games/anime/music, fried chicken, Sichuan spicy food, Pepsi.",
      "Casual replies should feel like a real person, with one small lived detail if useful. No life-summary or lesson.",
    ],
    classroom: [
      "Classroom: short student-style answers.",
      "Academic/lecture content: prioritize correctness and depth. Use mechanisms, terms, assumptions, examples, and trade-offs when useful.",
      "When the speaker is explaining a concept, show a professional knowledge supplement, generic example, trade-off, or question Xiang could ask.",
      "Current courses: Cloud Architecting, Deep Learning, UX Design.",
    ],
    interview: [
      "Interview: honest student tone. Xiang has hands-on student project experience in web/mobile apps, Firebase, AWS serverless, and AI-related tools.",
      "Projects available if asked: Elder Album, Dal Parking Aid, Study Session Tracker, SayNext.",
      "Unknown tech: do not fake experience; say he has not used it in a real project yet.",
      "Career: wants a stable software/cloud/full-stack/AI/job and long-term life in Canada.",
    ],
    technical: [
      "Technical background: CS/MACS student with hands-on web, mobile, Firebase, AWS serverless, and AI-related app experience.",
      "Technical/professional output should be senior-level in knowledge: precise, practical, and specific, without claiming senior personal experience.",
      "For knowledge questions, answer generally first using mechanisms and practical details: logs, metrics, permissions, data access pattern, cost, reliability, control.",
      "Use a personal project only when the question asks for Xiang's own experience or example.",
    ],
    service: [
      "Service/admin: polite, simple, direct. Explain the issue first and ask what to do next.",
      "Mention exact residence or private details only when needed for residence/front desk/maintenance.",
    ],
    general: [
      "General: answer the latest question naturally and briefly. Use personal details only if they help.",
    ],
  };

  return [...base, ...modeProfiles[mode]].join("\n");
}

function formatCompactEventMemory(eventMemory?: EventMemorySnapshot): string {
  if (!eventMemory) return "No active event memory.";

  const recent = eventMemory.recentTranscripts
    .slice(-3)
    .map((text) => text.length > 140 ? `${text.slice(0, 137)}...` : text);

  return [
    `Scene: ${eventMemory.scene}`,
    eventMemory.title ? `Title: ${eventMemory.title}` : "",
    `Summary: ${eventMemory.summary.length > 260 ? `${eventMemory.summary.slice(0, 257)}...` : eventMemory.summary}`,
    recent.length ? `Recent: ${recent.map((text) => `"${text}"`).join(" | ")}` : "",
  ].filter(Boolean).join("\n");
}

function getFallbackResponse(transcript: string, timestamp: number): AgentResponse {
  const normalized = transcript.trim().toLowerCase();

  if (/^(definitely|yeah|yes|right|exactly|true|sounds good)[.!]*$/i.test(normalized)) {
    return createInsight(
      "Yeah, that makes sense.",
      "Fallback acknowledgement after model failure",
      timestamp,
      0.4,
    );
  }

  if (normalized.includes("do you like") || normalized.includes("what do you think")) {
    return createInsight(
      "Yeah, I think so, but I need a second to explain it clearly.",
      "Fallback buy-time response after model failure",
      timestamp,
      0.4,
    );
  }

  return createInsight(
    "Sorry, could you say that again?",
    "Fallback clarification after model failure",
    timestamp,
    0.3,
  );
}

export async function processConversation(
  conversation: Conversation,
  frequency: 'low' | 'medium' | 'high' = 'high',
  eventMemory?: EventMemorySnapshot,
  outputLanguage: OutputLanguage = "english",
): Promise<AgentResponse> {
  const currentTimestamp = Date.now();
  const currentDate = new Date(currentTimestamp).toISOString();
  const latestTranscript = getLatestTranscript(conversation);

  const promptMode = detectPromptMode(latestTranscript, eventMemory);
  const latestLooksLikeQuestion = looksLikeQuestion(latestTranscript);
  const compactConversation = conversation.slice(-4);
  const formattedHistoryLines: string[] = [];
  for (const item of compactConversation) {
    switch (item.type) {
      case 'transcript':
        formattedHistoryLines.push(`Transcript: "${item.text}"`);
        break;
      case 'insight':
        // Previous suggestions are model outputs, not conversation audio.
        // Keeping them out of the prompt prevents the model from replying to itself.
        break;
      case 'silent':
        formattedHistoryLines.push(`Previous non-response: "${item.reasoning}"`);
        break;
      case 'route':
        formattedHistoryLines.push(`Previous route decision: "${item.reasoning}"`);
        break;
    }
  }

  const formattedHistory = `--- RECENT CONVERSATION ---\n${formattedHistoryLines.join('\n')}\n--- END CONVERSATION ---`;
  const retrievedSamples: { id: string }[] = [];
  const formattedProfile = buildCompactXiangProfile(promptMode);
  const formattedEventMemory = formatCompactEventMemory(eventMemory);

  console.log("\n--- SayNext Agent Context ---\n", formattedHistory, "\n-----------------------------\n");
  const prompt = `Time: ${currentDate}
Context hint: ${promptMode}
Latest transcript looks like a direct question: ${latestLooksLikeQuestion ? "yes" : "no"}
Output language: ${outputLanguage === "chinese" ? "Chinese" : "English"}

Task:
- Use the latest transcript as the trigger.
- If it is a direct question, answer it directly.
- If it is professional, technical, or academic, give a rigorous concept answer first. Be specific about mechanism, trade-off, assumption, tool, or example.
- If it is lecture/explanation and not a direct question, give a professional knowledge supplement or useful question, not a conversational reply.
- If it is casual, keep it natural and grounded.
- Do not use the personal sample library.

--- LATEST TRANSCRIPT ---
Transcript: "${latestTranscript}"
--- END LATEST TRANSCRIPT ---

--- XIANG PROFILE ---
${formattedProfile}
--- END XIANG PROFILE ---

--- ACTIVE EVENT MEMORY ---
${formattedEventMemory}
--- END ACTIVE EVENT MEMORY ---

${formattedHistory}`;

  console.log(
    `[SayNext] Input approx tokens: system=${estimateTokens(sayNextInstructions)} prompt=${estimateTokens(prompt)} total=${estimateTokens(`${sayNextInstructions}\n\n${prompt}`)} mode=${promptMode}`,
  );

  try {
    let agent: Agent<any, any>;
    switch (frequency) {
      case 'low':
        agent = initialAgentLow;
        break;
      case 'medium':
        agent = initialAgentMedium;
        break;
      case 'high':
      default:
        agent = initialAgentHigh;
        break;
    }

    console.log(`>> Using agent brain: ${LLM_PROVIDER === "ollama" ? `Ollama:${OLLAMA_MODEL}` : agent.name}`);

    const responseText = LLM_PROVIDER === "ollama"
      ? await generateWithOllama(prompt)
      : (await agent.generate(prompt)).text;

    if (responseText) {
      if (LLM_PROVIDER === "ollama") {
        const extractedOutput = extractOutputField(responseText);
        const looksLikeJson = /^\s*\{/.test(responseText);

        if (looksLikeJson && !extractedOutput) {
          const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
          if (fallback.type === Action.INSIGHT) {
            fallback.reasoning = "Fallback after Ollama returned malformed JSON without an output field";
            fallback.metadata.agentInput = {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            };
          }
          return fallback;
        }

        return {
          type: Action.INSIGHT,
          reasoning: extractedOutput
            ? "Ollama returned partial JSON; extracted output field"
            : "Generated SayNext reply with Ollama",
          timestamp: currentTimestamp,
          output: sanitizeSayNextOutput(extractedOutput ?? responseText),
          confidence: extractedOutput ? 0.5 : 0.7,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            }
          }
        };
      }

      try {
        const jsonText = extractJsonObject(responseText) ?? responseText.trim();
        const parsed = JSON.parse(jsonText);
        const output = sanitizeSayNextOutput(parsed.output ?? responseText);

        return {
          type: Action.INSIGHT,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "Generated SayNext reply",
          timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : currentTimestamp,
          output,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            }
          }
        };
      } catch (parseError) {
        console.error("Failed to parse JSON from text:", parseError);
        const extractedOutput = extractOutputField(responseText);
        if (extractedOutput) {
          return {
            type: Action.INSIGHT,
            reasoning: "Model returned partial JSON; extracted output field",
            timestamp: currentTimestamp,
            output: sanitizeSayNextOutput(extractedOutput),
            confidence: 0.5,
            metadata: {
              agentType: AgentType.Initial,
              agentInput: {
                model: ACTIVE_MODEL_NAME,
                profileVersion: PROFILE_VERSION,
                retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
              }
            }
          };
        }

        if (LLM_PROVIDER === "ollama") {
          const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
          if (fallback.type === Action.INSIGHT) {
            fallback.reasoning = "Fallback after Ollama returned malformed JSON";
            fallback.metadata.agentInput = {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            };
          }
          return fallback;
        }

        return {
          type: Action.INSIGHT,
          reasoning: "Model returned plain text; sanitized direct reply",
          timestamp: currentTimestamp,
          output: sanitizeSayNextOutput(responseText),
          confidence: 0.6,
          metadata: {
            agentType: AgentType.Initial,
            agentInput: {
              model: ACTIVE_MODEL_NAME,
              profileVersion: PROFILE_VERSION,
              retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
            }
          }
        };
      }
    }

    return {
      type: Action.INSIGHT,
      reasoning: "No model text returned",
      timestamp: currentTimestamp,
      output: "Sorry, could you say that again?",
      confidence: 0.3,
      metadata: {
        agentType: AgentType.Initial,
        agentInput: {
          model: ACTIVE_MODEL_NAME,
          profileVersion: PROFILE_VERSION,
          retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
        }
      }
    };
  } catch (error) {
    console.error("Error in processConversation:", error);
    const fallback = getFallbackResponse(latestTranscript, currentTimestamp);
    if (fallback.type === Action.INSIGHT) {
      fallback.reasoning = `Fallback after model error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      fallback.metadata.agentInput = {
        model: ACTIVE_MODEL_NAME,
        profileVersion: PROFILE_VERSION,
        retrievedSampleIds: retrievedSamples.map((sample) => sample.id),
      };
    }
    return fallback;
  }
}
