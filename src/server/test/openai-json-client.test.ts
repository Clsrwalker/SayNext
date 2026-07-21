import { expect, test } from "bun:test";
import { generateOpenAiJson } from "../local-llm/openai-json-client";

test("OpenAI JSON client can attach a Responses request to a conversation", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  const result = await generateOpenAiJson<{ ok: boolean }>({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body || "{}")),
      });
      return new Response(JSON.stringify({ output_text: "{\"ok\":true}" }), { status: 200 });
    },
    model: "gpt-test",
    prompt: "Only this turn's dynamic input",
    conversationId: "conv_openai_1",
    promptCacheKey: "saynext-fixed-v1",
    includeJsonInstruction: false,
  });

  expect(result.data).toEqual({ ok: true });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://api.openai.test/v1/responses");
  expect(requests[0].body.conversation).toBe("conv_openai_1");
  expect(requests[0].body.prompt_cache_key).toBe("saynext-fixed-v1");
  expect(requests[0].body.input).toEqual([{
    role: "user",
    content: [{
      type: "input_text",
      text: "Only this turn's dynamic input",
    }],
  }]);
});
