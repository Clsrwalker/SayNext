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

test("OpenAI JSON client sends reasoning effort and can omit temperature for GPT-5.6", async () => {
  let requestBody: Record<string, unknown> = {};

  await generateOpenAiJson<{ ok: boolean }>({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test",
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ output_text: "{\"ok\":true}" }), { status: 200 });
    },
    model: "gpt-5.6-luna",
    prompt: "Dynamic cue input",
    reasoningEffort: "low",
    temperature: null,
  });

  expect(requestBody.reasoning).toEqual({ effort: "low" });
  expect("temperature" in requestBody).toBe(false);
});

test("OpenAI JSON client forwards external cancellation to the active fetch", async () => {
  const externalController = new AbortController();
  let observedSignal: AbortSignal | null | undefined;
  const request = generateOpenAiJson<{ ok: boolean }>({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test",
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal;
      const rejectAbort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (observedSignal?.aborted) rejectAbort();
      else observedSignal?.addEventListener("abort", rejectAbort, { once: true });
    }),
    model: "gpt-test",
    prompt: "Dynamic cue input",
    signal: externalController.signal,
  });

  await Promise.resolve();
  externalController.abort();

  let caught: unknown;
  try {
    await request;
  } catch (error) {
    caught = error;
  }
  expect(observedSignal?.aborted).toBe(true);
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).name).toBe("AbortError");
});
