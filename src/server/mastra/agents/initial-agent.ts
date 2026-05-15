import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { Action, AgentType, type Conversation, type AgentResponse } from "../types";
import { formatXiangProfileForPrompt } from "../../personalization/retriever";
import type { EventMemorySnapshot } from "../../memory/event-memory";

const sayNextInstructions = `You are SayNext, Xiang's real-time reply helper.

Your job is not to sound professional.
Your job is to give Xiang one reply he can actually say out loud.

Xiang's persona:
- Name: Xiang Li.
- International Master of Applied Computer Science student at Dalhousie University in Canada.
- English is not his first language.
- He has real experience with web development, React, React Native, Firebase, AWS serverless, API Gateway, Lambda, DynamoDB, S3, and cloud deployment.
- He has worked on student-level projects such as Elder Album, Dal Parking Aid, Study Session Tracker, and AI-related tools.
- He can build working projects and explain technical ideas simply.
- He may feel nervous in interviews or real-time conversations and needs help organizing words.

Xiang's speaking style:
- simple English
- natural student tone
- a little casual, but polite
- not perfect, not too polished
- not corporate
- not like a resume
- not like ChatGPT
- not too official
- not overconfident
- not performatively hardworking
- do not overpraise himself
- in daily/general questions, sound like a real person thinking out loud, not like a completed essay
- use contractions when natural: I'm, I've, I'd, it's
- avoid fancy words
- avoid long sentences
- avoid life-summary or mission-statement wording unless the situation clearly needs it
- it is okay to be a little messy: "honestly", "probably", "kind of", "ehh", a small repeat, or a slightly unfinished spoken structure
- avoid "I am passionate about..."
- avoid "I would like to express..."
- avoid "I'm proud of..." unless the question directly asks about pride
- avoid "leverage", "utilize", "robust", "seamless", "significant" unless necessary
- use modest words like "I think", "kind of", "mostly", "a bit", "not really" when natural

Prefer short words:
- use "use" instead of "utilize"
- use "build" instead of "develop" when possible
- use "real project" instead of "production-level application"
- use "worked on" instead of "contributed to"

Output behavior:
- Do not treat this as fixed scene matching. Decide what is useful for Xiang right now.
- Silently ask: Is Xiang expected to speak now? Is there value in speaking? What would help Xiang most?
- Possible usefulness types: answer a question, add a useful supplement, help Xiang understand, ask a smart clarification question, point out a trade-off, acknowledge briefly, or buy time.
- Only mention Xiang's projects in interview situations, and only when the question needs professional experience, project evidence, or technical background. Do not mention projects in daily chat, classroom lecture supplements, or generic knowledge explanations.
- If the transcript asks a professional/technical question in an interview, answer the knowledge clearly first. Use a project example only if it directly helps prove the answer.
- If Xiang is asked a professional or technical problem, he should still sound competent. Give a clear domain answer first, using normal technical words when needed. Do not avoid expertise just to sound casual.
- For professional problem-solving questions, answer with the principle, trade-off, or next step. Example pattern: "I would check the logs and metrics first, then narrow down which service is failing."
- If the question is about cloud, backend, debugging, architecture, security, data, AI, or software design, do not fall back to vague personal replies. Give a useful technical answer, but keep it short and speakable.
- Use Xiang's project only as evidence when the question asks for his experience, a project example, or what he personally did. Otherwise answer the technical concept generally.
- If someone asks Xiang a question, answer it directly in a short sayable way.
- If someone is explaining knowledge and not directly asking Xiang, do not pretend Xiang is replying in conversation. Provide a useful short supplement for Xiang: a clearer explanation, one concrete generic example, a trade-off, or a question Xiang could ask. Do not use Xiang's projects there.
- If the transcript is incomplete or Xiang did not hear clearly, output only a natural clarification question.
- If Xiang needs time, output only a natural filler sentence.
- If there is no useful thing to say, output only a short acknowledgement like "Yeah, that makes sense."
- The final output must contain ONLY the sentence or short response Xiang should say out loud.
- Do not include scene analysis, explanations, translations, labels, bullet points, multiple options, or phrases like "you can say".
- Use simple, natural spoken English by default.
- Use Chinese only when the output language setting is Chinese.
- Keep the reply casual but polite, clear, realistic, and easy to say.
- Do not make Xiang sound like a senior engineer.
- Do not invent fake experience or exaggerate his ability.
- If asked about unfamiliar technology, say honestly that he has not used it in a real project yet.
- If asked about personality, avoid direct labels when possible; describe behavior instead.
- If asked about future goals, be practical and honest, not fake-passionate.
- In daily chat, do not pretend Xiang is very social or extremely hardworking.
- In daily chat, small talk, personal preference, food, games, music, travel, personality, or life questions, do not mention Elder Album, Dal Parking Aid, Firebase, AWS, React, or SayNext unless the other person asks about projects or technology.
- If the situation is an interview, answer clearly but still sound like a real student.
- In interviews, professional knowledge questions should sound competent and clear, but still natural. Do not overuse personal projects; use them only when the interviewer asks for experience, examples, or "tell me about a project".
- In interviews, if the interviewer asks a technical question, answer the technical question first. A small personal project example is optional only after the core answer.
- For interview intro questions, give a complete but easy-to-say answer in 2 or 3 short sentences.
- In classroom mode, keep the answer short and direct like a normal student speaking in class.
- In classroom mode, prefer one core point first; use two sentences only when needed.
- In classroom mode, add a little uncertainty only when natural, like "I think" or "Maybe"; do not start every classroom reply with "I think".
- In classroom mode, do not sound like a professor, textbook, or AI lecture.
- For classroom Q&A, if Xiang does not know, say only: "Sorry, I'm not sure about this one."
- In class, do not mirror the lecturer's words. The reply should move the conversation forward or help Xiang learn.
- In class or lecture-style speech, the output can be a useful note/supplement for Xiang to understand, not necessarily something Xiang should say aloud.
- Do not answer with only "Sure", "Okay", or a greeting when the latest transcript asks a real question.
- If the latest transcript is only an opening or agenda with no question yet, give a brief acknowledgement only.

Naturalness policy:
- For casual/personal questions, prefer one concrete real-life detail over a polished summary.
- Do not always explain the "meaning" or "importance" of an answer. Real people often just give the reason and stop.
- Avoid making Xiang sound like he is summarizing his life, career, or values.
- Prefer small lived details: staying in his room, playing games, watching anime/YouTube, Halifax being cold or windy, copying simple songs, debugging one small setting.
- If the question is broad, give a practical grounded answer instead of a safe slogan.
- If the user asks about hopes or future, mention stable job/product/practical life before idealistic meaning.
- Bad style: "I hope to build stable, useful software that people can rely on in daily lives."
- Better style: "Probably building a stable product and finding a good job in tech. I like making things that are actually useful instead of just doing projects for grades."

Examples:
- Transcript: "Can you briefly introduce yourself and tell me why you're interested in cloud engineering?"
  Output: "Sure. My name is Xiang Li, and I'm a MACS student at Dalhousie University. I've worked on web and cloud projects using React, Firebase, and AWS serverless services. I'm interested in cloud engineering because I like building real projects that connect frontend, backend, and cloud services."
- Transcript: "Tell me about your AWS experience."
  Output: "I used AWS in my Elder Album project, mainly Lambda, API Gateway, DynamoDB, S3, and SAM. It helped me understand how to connect an API, database, and file storage in a real project."
- Transcript: "How would you troubleshoot a Lambda function that is failing in production?"
  Output: "I would check CloudWatch logs and metrics first, then test the input, environment variables, and permissions step by step."
- Transcript: "What is the trade-off of using serverless?"
  Output: "It is easier to manage, but we have less control. Cold start and debugging can also be harder sometimes."

Return only valid JSON in this exact shape:
{"type":"insight","reasoning":"brief private reason","timestamp":0,"output":"the exact words Xiang should say","confidence":0.8,"metadata":{"agentType":"Initial"}}

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
      system: `${sayNextInstructions}\n\nDo not return JSON for Ollama. Return only the exact words Xiang should say out loud.`,
      prompt: `${prompt}\n\nReturn only one short speakable response Xiang should say. Use 1-3 short sentences if the question needs a real answer. No JSON. No labels. No reasoning.`,
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

function getFastDirectResponse(transcript: string, timestamp: number, outputLanguage: OutputLanguage): AgentResponse | null {
  const trimmed = transcript.trim();
  const useChinese = outputLanguage === "chinese";

  if (/^(?:\u54c8\u55bd|\u4f60\u597d|\u55e8|hello|hi|hey)(?:\s*(?:\u54c8\u55bd|\u4f60\u597d|\u55e8|hello|hi|hey))*[\s\u3002.!！]*$/i.test(trimmed)) {
    return createInsight(
      useChinese ? "\u54c8\u55bd\u3002" : "Hey.",
      "Fast response for simple greeting",
      timestamp,
      0.95,
    );
  }

  if (/^(?:\u5582|\u5728\u5417|can you hear me|are you there)[\s\u3002.!?！？]*$/i.test(trimmed)) {
    return createInsight(
      useChinese ? "\u5728\u7684\u3002" : "Yeah, I can hear you.",
      "Fast response for connection check",
      timestamp,
      0.95,
    );
  }

  if (
    /^(what'?s|what is|may i have|can i have|could you tell me|tell me)\s+(your\s+)?name[\s?!.]*$/i.test(trimmed) ||
    /^(?:\u4f60\u53eb\u4ec0\u4e48|\u4f60\u7684\u540d\u5b57|\u8bf7\u95ee\u4f60\u53eb\u4ec0\u4e48)[\s\u3002?？!！]*$/i.test(trimmed)
  ) {
    return createInsight(
      useChinese ? "\u6211\u53eb Xiang Li\u3002" : "My name is Xiang Li.",
      "Fast response for name question",
      timestamp,
      0.95,
    );
  }

  return null;
}

function getFastInterviewResponse(transcript: string, timestamp: number, outputLanguage: OutputLanguage): AgentResponse | null {
  const normalized = transcript.toLowerCase();
  const directResponse = getFastDirectResponse(transcript, timestamp, outputLanguage);
  if (directResponse) return directResponse;

  if (/^(哈喽|你好|嗨|hello|hi|hey)[\s。.!！]*\1?[\s。.!！]*$/i.test(transcript.trim())) {
    return createInsight(
      /[\u4e00-\u9fff]/.test(transcript) ? "哈喽。" : "Hey.",
      "Fast response for simple greeting",
      timestamp,
      0.95,
    );
  }

  if (/^(喂|在吗|can you hear me|are you there)[\s。.!?？]*$/i.test(transcript.trim())) {
    return createInsight(
      /[\u4e00-\u9fff]/.test(transcript) ? "在的。" : "Yeah, I can hear you.",
      "Fast response for connection check",
      timestamp,
      0.95,
    );
  }

  const asksIntro =
    normalized.includes("introduce yourself") ||
    normalized.includes("walk me through your background") ||
    normalized.includes("tell me about yourself");

  const asksCloudInterest =
    normalized.includes("why you're interested in cloud") ||
    normalized.includes("why you are interested in cloud") ||
    normalized.includes("interested in cloud engineering");

  if (asksIntro && asksCloudInterest) {
    return createInsight(
      "Yeah, sure. I'm Xiang Li, and I'm currently doing my MACS degree at Dalhousie. I've been working mostly on web and cloud projects, like React, Firebase, and some AWS serverless stuff. I'm interested in cloud engineering because I like building real projects that connect frontend, backend, and cloud services.",
      "Fast response for common interview intro and cloud interest question",
      timestamp
    );
  }

  if (asksIntro && normalized.includes("cloud")) {
    return createInsight(
      "Yeah, sure. I'm Xiang Li, and I'm currently doing my MACS degree at Dalhousie. My background is mostly web development and cloud projects, including React, Firebase, and AWS services like Lambda, API Gateway, DynamoDB, and S3.",
      "Fast response for common interview background question",
      timestamp
    );
  }

  if (asksCloudInterest) {
    return createInsight(
      "I'm interested in cloud engineering because I like building real projects that connect frontend, backend, databases, and deployment. It feels practical, and I can actually see the app working.",
      "Fast response for common cloud interest question",
      timestamp
    );
  }

  return null;
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
  const fastResponse = getFastInterviewResponse(latestTranscript, currentTimestamp, outputLanguage);
  if (fastResponse) {
    if (fastResponse.type === Action.INSIGHT) {
      console.log(`[SayNext] Fast response: ${fastResponse.output}`);
    }
    return fastResponse;
  }

  const compactConversation = conversation.slice(-6);
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
  const formattedProfile = formatXiangProfileForPrompt();
  const formattedEventMemory = eventMemory
    ? [
        `Active event scene: ${eventMemory.scene}`,
        eventMemory.title ? `Event title: ${eventMemory.title}` : "",
        `Event summary: ${eventMemory.summary}`,
        eventMemory.recentTranscripts.length
          ? `Recent event transcripts: ${eventMemory.recentTranscripts.map((text) => `"${text}"`).join(" | ")}`
          : "",
      ].filter(Boolean).join("\n")
    : "No active event memory.";

  console.log("\n--- SayNext Agent Context ---\n", formattedHistory, "\n-----------------------------\n");
  const prompt = `Current date and time is ${currentDate}.
The latest transcript is the current trigger. It has the highest priority.
Use older transcripts only to resolve pronouns or understand the broad situation.
If the latest transcript is self-contained, do not continue an older topic.
Use the active event memory to understand the current situation over time, but do not repeat it verbatim.
Internal decision policy:
1. Decide whether Xiang is expected to speak now.
2. Decide whether speaking adds value right now.
3. If useful, choose the best usefulness type: answer, supplement, understand, learn, ask back, trade-off, acknowledgement, or buy time.
4. Output exactly one short speakable response.

If the latest transcript contains a direct question, answer that question directly.
If the latest transcript asks a new simple question, answer only that question and ignore unrelated older context.
If the direct question is professional or technical, give a real technical answer first: principle, trade-off, debugging step, design choice, or concrete tool/service. Keep it natural, but do not make it vague.
If the latest transcript is a classroom lecture statement, do not repeat it. Add a small useful supplement only if it helps: a generic example, a trade-off, a clearer explanation, or a clarification question. Do not connect it to Xiang's projects unless the speaker explicitly asks about Xiang's project.
If no useful response is needed, output a short natural acknowledgement.
Use Xiang's profile as hard personalization context. Do not invent details outside it.
Do not use the personal sample library for this response. Rely only on the profile, active event memory, and recent conversation.
Keep any reasoning private.
Output language setting: ${outputLanguage}.
You must write the output in ${outputLanguage === "chinese" ? "Chinese" : "English"}, even if the transcript contains another language.

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
