import { expect, test } from "bun:test";
import { OpenAiConversationClient } from "../evenhub-v2/openai-conversation-client";

test("OpenAI conversation client creates a conversation with one developer seed", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const client = new OpenAiConversationClient({
    apiKey: "test-key",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body || "{}")) });
      return new Response(JSON.stringify({ id: "conv_openai_1" }), { status: 200 });
    },
  });

  const session = await client.createSession({
    seed: "Fixed SayNext instructions",
    localConversationId: "conv-local",
    userId: "xiang",
  });

  expect(session.id).toBe("conv_openai_1");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toEndWith("/v1/conversations");
  expect(requests[0].body.items).toEqual([{
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: "Fixed SayNext instructions" }],
  }]);
});

test("OpenAI conversation client commits only an accepted canonical question and cue", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const client = new OpenAiConversationClient({
    apiKey: "test-key",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body || "{}")) });
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    },
  });

  await client.commitCanonicalTurn({
    conversationId: "conv_openai_1",
    question: "Tell me about yourself.",
    answerJson: '{"category":"response","fullAnswer":"I am Xiang."}',
  });

  expect(requests[0].url).toEndWith("/v1/conversations/conv_openai_1/items");
  expect(requests[0].body.items).toEqual([
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Current authoritative question:\nTell me about yourself." }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: '{"category":"response","fullAnswer":"I am Xiang."}' }],
    },
  ]);
});
