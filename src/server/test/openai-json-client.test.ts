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
    serviceTier: "priority",
    temperature: null,
  });

  expect(requestBody.reasoning).toEqual({ effort: "low" });
  expect(requestBody.service_tier).toBe("priority");
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

for (const phase of ["headers", "success body", "error body"] as const) {
  test(`OpenAI JSON deadline covers hanging ${phase} even when transport ignores abort`, async () => {
    let observedSignal: AbortSignal | null | undefined;
    const request = generateOpenAiJson({
      apiKey: "test-key", prompt: "test", timeoutMs: 10,
      fetchImpl: async (_input, init) => {
        observedSignal = init?.signal;
        if (phase === "headers") return new Promise<Response>(() => {});
        return {
          ok: phase === "success body", status: phase === "success body" ? 200 : 500,
          json: () => new Promise(() => {}), text: () => new Promise(() => {}),
        } as unknown as Response;
      },
    });
    await expect(request).rejects.toHaveProperty("name", "AbortError");
    expect(observedSignal?.aborted).toBe(true);
  });
}

for (const ok of [true, false]) {
  test(`OpenAI JSON external abort remains connected while reading ${ok ? "success" : "error"} body`, async () => {
    const controller = new AbortController();
    let readingBody!: () => void;
    const enteredBody = new Promise<void>((resolve) => { readingBody = resolve; });
    const read = () => { readingBody(); return new Promise(() => {}); };
    const request = generateOpenAiJson({
      apiKey: "test-key", prompt: "test", signal: controller.signal, timeoutMs: 1000,
      fetchImpl: async () => ({ ok, status: ok ? 200 : 500, json: read, text: read }) as unknown as Response,
    });
    await enteredBody;
    controller.abort();
    await expect(request).rejects.toHaveProperty("name", "AbortError");
  });
}

for (const outcome of ["success", "sync throw", "async reject", "bad json", "http error"] as const) {
  test(`OpenAI JSON cleans cancellation and deadline after ${outcome}`, async () => {
    const external = new AbortController();
    let activeListeners = 0;
    const add = external.signal.addEventListener.bind(external.signal);
    const remove = external.signal.removeEventListener.bind(external.signal);
    external.signal.addEventListener = ((...args: Parameters<typeof add>) => {
      if (args[0] === "abort") activeListeners += 1;
      return add(...args);
    }) as typeof add;
    external.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
      if (args[0] === "abort") activeListeners -= 1;
      return remove(...args);
    }) as typeof remove;
    let observedSignal: AbortSignal | null | undefined;
    const request = generateOpenAiJson({
      apiKey: "test-key", prompt: "test", signal: external.signal, timeoutMs: 10,
      fetchImpl: (_input, init) => {
        observedSignal = init?.signal;
        if (outcome === "sync throw") throw new Error("sync failure");
        if (outcome === "async reject") return Promise.reject(new Error("async failure"));
        return Promise.resolve(new Response(outcome === "bad json" ? "invalid" : JSON.stringify({ output_text: '{"ok":true}' }), {
          status: outcome === "http error" ? 500 : 200,
        }));
      },
    });
    if (outcome === "success") expect((await request).data).toEqual({ ok: true });
    else await expect(request).rejects.toBeInstanceOf(Error);
    expect(activeListeners).toBe(0);
    external.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observedSignal?.aborted).toBe(false);
  });
}

test("OpenAI JSON pre-aborted requests never call the transport", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await expect(generateOpenAiJson({
    apiKey: "test-key", prompt: "test", signal: controller.signal,
    fetchImpl: async () => { calls += 1; return new Response(); },
  })).rejects.toHaveProperty("name", "AbortError");
  expect(calls).toBe(0);
});
