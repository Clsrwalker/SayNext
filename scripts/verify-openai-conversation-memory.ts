import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join("data", "eval");

type Step = {
  name: string;
  ok: boolean;
  status?: number;
  detail: unknown;
};

function extractResponseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const texts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const contentItem of item?.content ?? []) {
      if (typeof contentItem?.text === "string") texts.push(contentItem.text);
    }
  }
  return texts.join("\n").trim();
}

function extractOutputItemIds(data: any): string[] {
  const ids: string[] = [];
  for (const item of data?.output ?? []) {
    if (typeof item?.id === "string") ids.push(item.id);
  }
  return ids;
}

function summarizeItems(data: any): Array<{ id?: string; role?: string; type?: string; text: string }> {
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.map((item: any) => {
    const textParts: string[] = [];
    for (const contentItem of item?.content ?? []) {
      if (typeof contentItem?.text === "string") textParts.push(contentItem.text);
      if (typeof contentItem?.input_text === "string") textParts.push(contentItem.input_text);
      if (typeof contentItem?.output_text === "string") textParts.push(contentItem.output_text);
    }
    return {
      id: typeof item?.id === "string" ? item.id : undefined,
      role: typeof item?.role === "string" ? item.role : undefined,
      type: typeof item?.type === "string" ? item.type : undefined,
      text: textParts.join("\n").replace(/\s+/g, " ").trim().slice(0, 220),
    };
  });
}

async function requestJson(apiKey: string, url: string, init: RequestInit): Promise<{ status: number; ok: boolean; json: any; text: string }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json, text };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("OPENAI_API_KEY is not configured; skipping verification.");
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const steps: Step[] = [];

  const create = await requestJson(apiKey, OPENAI_CONVERSATIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metadata: {
        purpose: "saynext_conversation_memory_verification",
        run: timestamp,
      },
    }),
  });
  const conversationId = typeof create.json?.id === "string" ? create.json.id : "";
  steps.push({
    name: "create_conversation",
    ok: create.ok && Boolean(conversationId),
    status: create.status,
    detail: { conversationId, rawType: create.json?.object || create.json?.type },
  });

  if (!conversationId) {
    throw new Error(`Could not create conversation: ${create.status} ${create.text}`);
  }

  const firstTranscript = "Transcript: \"My project uses hybrid search, memory gating, and input token reduction.\"";
  const first = await requestJson(apiKey, OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      conversation: conversationId,
      instructions: "Answer briefly. Remember prior transcript items in this conversation.",
      input: [{ role: "user", content: [{ type: "input_text", text: firstTranscript }] }],
      temperature: 0.1,
    }),
  });
  const firstOutputIds = extractOutputItemIds(first.json);
  steps.push({
    name: "first_response_write_transcript",
    ok: first.ok && firstOutputIds.length > 0,
    status: first.status,
    detail: {
      output: extractResponseText(first.json),
      responseId: first.json?.id,
      outputItemIds: firstOutputIds,
    },
  });

  const second = await requestJson(apiKey, OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      conversation: conversationId,
      instructions: "Answer briefly. Use prior transcript items if relevant.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Transcript: \"What was my project about?\"" }] }],
      temperature: 0.1,
    }),
  });
  const secondText = extractResponseText(second.json);
  const memoryLooksPresent = /hybrid search|memory gating|input token/i.test(secondText);
  const secondOutputIds = extractOutputItemIds(second.json);
  steps.push({
    name: "second_response_uses_prior_transcript",
    ok: second.ok && memoryLooksPresent,
    status: second.status,
    detail: {
      output: secondText,
      memoryLooksPresent,
      responseId: second.json?.id,
      outputItemIds: secondOutputIds,
    },
  });

  const beforeItems = await requestJson(apiKey, `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items`, {
    method: "GET",
  });
  const beforeSummary = summarizeItems(beforeItems.json);
  steps.push({
    name: "list_items_before_cleanup",
    ok: beforeItems.ok,
    status: beforeItems.status,
    detail: {
      count: beforeSummary.length,
      items: beforeSummary,
      rawKeys: beforeItems.json ? Object.keys(beforeItems.json) : [],
    },
  });

  const outputIds = [...firstOutputIds, ...secondOutputIds];
  const deleteResults: Array<{ itemId: string; status: number; ok: boolean; text: string }> = [];
  for (const itemId of outputIds) {
    const deleted = await requestJson(apiKey, `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
    deleteResults.push({ itemId, status: deleted.status, ok: deleted.ok, text: deleted.text.slice(0, 240) });
  }
  steps.push({
    name: "delete_assistant_output_items",
    ok: deleteResults.length > 0 && deleteResults.every((item) => item.ok),
    detail: deleteResults,
  });

  const afterItems = await requestJson(apiKey, `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items`, {
    method: "GET",
  });
  const afterSummary = summarizeItems(afterItems.json);
  const assistantOutputsRemain = afterSummary.some((item) => outputIds.includes(item.id || ""));
  steps.push({
    name: "list_items_after_cleanup",
    ok: afterItems.ok && !assistantOutputsRemain,
    status: afterItems.status,
    detail: {
      count: afterSummary.length,
      assistantOutputsRemain,
      items: afterSummary,
      rawKeys: afterItems.json ? Object.keys(afterItems.json) : [],
    },
  });

  const report = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    conversationId,
    passed: steps.every((step) => step.ok),
    steps,
  };

  const jsonPath = join(outDir, `openai-conversation-memory-verify-${timestamp}.json`);
  const mdPath = join(outDir, `openai-conversation-memory-verify-${timestamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, [
    "# OpenAI Conversation Memory Verification",
    "",
    `Generated: ${report.generatedAt}`,
    `Model: ${MODEL}`,
    `Conversation: ${conversationId}`,
    `Passed: ${report.passed ? "yes" : "no"}`,
    "",
    ...steps.flatMap((step) => [
      `## ${step.name}`,
      `Status: ${step.status ?? ""}`,
      `OK: ${step.ok ? "yes" : "no"}`,
      "```json",
      JSON.stringify(step.detail, null, 2),
      "```",
      "",
    ]),
  ].join("\n"), "utf8");

  console.log(`Verification report: ${mdPath}`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
