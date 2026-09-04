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

for (const phase of ["headers", "success body", "error body"] as const) {
  test(`OpenAI conversation deadline covers hanging ${phase}`, async () => {
    let observedSignal: AbortSignal | null | undefined;
    const client = new OpenAiConversationClient({
      apiKey: "test-key", timeoutMs: 10,
      fetchImpl: async (_input, init) => {
        observedSignal = init?.signal;
        if (phase === "headers") return new Promise<Response>(() => {});
        return {
          ok: phase === "success body", status: phase === "success body" ? 200 : 500,
          text: () => new Promise(() => {}),
        } as unknown as Response;
      },
    });
    await expect(client.createSession({ seed: "seed", localConversationId: "local", userId: "user" }))
      .rejects.toHaveProperty("name", "AbortError");
    expect(observedSignal?.aborted).toBe(true);
  });
}

for (const operation of ["create", "commit", "delete"] as const) {
  for (const ok of [true, false]) {
    test(`OpenAI conversation ${operation} externally cancels a hanging ${ok ? "success" : "error"} body`, async () => {
      const external = new AbortController();
      let readingBody!: () => void;
      const enteredBody = new Promise<void>((resolve) => { readingBody = resolve; });
      const client = new OpenAiConversationClient({
        apiKey: "test-key", timeoutMs: 1000,
        fetchImpl: async () => ({
          ok, status: ok ? 200 : 500, text: () => { readingBody(); return new Promise(() => {}); },
        }) as unknown as Response,
      });
      const request = operation === "create"
        ? client.createSession({ seed: "seed", localConversationId: "local", userId: "user", signal: external.signal })
        : operation === "commit"
          ? client.commitCanonicalTurn({ conversationId: "test", question: "q", answerJson: "{}", signal: external.signal })
          : client.deleteSession("test", external.signal);
      await enteredBody;
      external.abort();
      await expect(request).rejects.toHaveProperty("name", "AbortError");
    });
  }
}

for (const outcome of ["success", "sync throw", "async reject", "bad json", "http error"] as const) {
  test(`OpenAI conversation cleans cancellation and deadline after ${outcome}`, async () => {
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
    const client = new OpenAiConversationClient({
      apiKey: "test-key", timeoutMs: 10,
      fetchImpl: (_input, init) => {
        observedSignal = init?.signal;
        if (outcome === "sync throw") throw new Error("sync failure");
        if (outcome === "async reject") return Promise.reject(new Error("async failure"));
        return Promise.resolve(new Response(outcome === "bad json" ? "invalid" : "{}", {
          status: outcome === "http error" ? 500 : 200,
        }));
      },
    });
    const request = client.deleteSession("test", external.signal);
    if (outcome === "success") await request;
    else await expect(request).rejects.toBeInstanceOf(Error);
    expect(activeListeners).toBe(0);
    external.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observedSignal?.aborted).toBe(false);
  });
}

test("OpenAI conversation pre-aborted requests never call the transport", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = new OpenAiConversationClient({
    apiKey: "test-key", fetchImpl: async () => { calls += 1; return new Response(); },
  });
  await expect(client.deleteSession("test", controller.signal)).rejects.toHaveProperty("name", "AbortError");
  expect(calls).toBe(0);
});
