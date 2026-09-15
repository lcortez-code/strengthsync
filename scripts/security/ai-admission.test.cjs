const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module.cjs");
const { z } = require("zod");

const settings = { model: "test-model", temperature: 0.5, maxTokens: 500 };
const base = { memberId: "member", organizationId: "org", feature: "chat" };
const limiter = loadModule("src/lib/ai/rate-limiter.ts", { "@/lib/prisma": { prisma: {} } });

function serviceHarness({ allowed = true, providerError = false, reportedUsage = { inputTokens: 10, outputTokens: 5 } } = {}) {
  const calls = { reservations: [], providers: [], logs: [], trace: [] };
  const service = loadModule("src/lib/ai/service.ts", {
    ai: {
      generateText: async (options) => { calls.trace.push("provider"); calls.providers.push(options); if (providerError) throw new Error("provider failed"); return { text: "Answer", usage: reportedUsage }; },
      generateObject: async (options) => { calls.trace.push("provider"); calls.providers.push(options); return { object: { answer: "yes" }, usage: reportedUsage }; },
      streamText: (options) => { calls.trace.push("provider"); calls.providers.push(options); return { options }; },
      zodSchema: () => ({ jsonSchema: { type: "object", properties: { answer: { type: "string" } } } }),
    },
    "./client": { openai: () => "test-model", getFeatureSettings: () => settings, isAIConfigured: () => true },
    "./rate-limiter": {
      estimateTokenAllowance: limiter.estimateTokenAllowance,
      reserveAIRequest: async (options) => { calls.trace.push("admission"); calls.reservations.push(options); return { allowed, reservationId: allowed ? "reserved" : undefined, reason: allowed ? undefined : "quota", remaining: 1, resetAt: new Date() }; },
    },
    "./token-tracker": { logUsage: async (input) => { calls.logs.push(input); return input.reservationId; } },
    "./prompts": {}, "@/lib/prisma": { prisma: {} },
  });
  return { service, calls };
}

test("database admission errors fail closed", async () => {
  const failed = loadModule("src/lib/ai/rate-limiter.ts", { "@/lib/prisma": { prisma: { $transaction: async () => { throw new Error("database unavailable"); } } } });
  const result = await failed.reserveAIRequest({ ...base, endpoint: "/api/ai/chat", model: "test", reservedTokens: 100 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /unavailable/);
});

test("token allowance includes UTF-8 input, schema framing, and bounded output", () => {
  const input = { prompt: "日本語🌎", schema: { type: "string" } };
  assert.ok(limiter.estimateTokenAllowance(input, 500) > Buffer.byteLength(JSON.stringify(input)) + 500);
  for (const output of [0, -1, NaN, 4001, 1.5]) assert.throws(() => limiter.estimateTokenAllowance(input, output));
});

test("all generation surfaces deny provider work without admission", async () => {
  const { service, calls } = serviceHarness({ allowed: false });
  assert.equal((await service.generate({ ...base, prompt: "hello", skipRateLimitCheck: true })).success, false);
  assert.equal((await service.generateStructured({ ...base, prompt: "hello", schema: z.object({ answer: z.string() }) })).success, false);
  await assert.rejects(service.stream({ ...base, messages: [{ role: "user", content: "hello" }] }), /quota/);
  assert.equal(calls.providers.length, 0);
  assert.equal(calls.logs.length, 0);
});

test("text and structured generation reserve before provider and settle the same request", async () => {
  const { service, calls } = serviceHarness();
  await service.generate({ ...base, prompt: "hello", systemPrompt: "instructions" });
  await service.generateStructured({ ...base, prompt: "hello", schema: z.object({ answer: z.string() }) });
  assert.deepEqual(calls.trace, ["admission", "provider", "admission", "provider"]);
  assert.ok(calls.reservations.every((r) => r.reservedTokens > 500));
  assert.ok(calls.providers.every((p) => p.maxOutputTokens === 500 && p.maxRetries === 0));
  assert.ok(calls.logs.every((log) => log.reservationId === "reserved" && log.usage.totalTokens === 15));
});

test("provider failure records unknown spend on the admitted request", async () => {
  const { service, calls } = serviceHarness({ providerError: true });
  assert.equal((await service.generate({ ...base, prompt: "hello" })).success, false);
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].reservationId, "reserved");
  assert.equal(calls.logs[0].success, false);
  assert.equal(calls.logs[0].usage.totalTokens, 0);
});

test("streaming admission covers completion, abort, and error", async () => {
  const { service, calls } = serviceHarness();
  const { options } = await service.stream({ ...base, messages: [{ role: "user", content: "hello" }] });
  assert.deepEqual(calls.trace, ["admission", "provider"]);
  assert.equal(options.maxRetries, 0);
  await options.onAbort({ steps: [] });
  await options.onError({ error: new Error("interrupted") });
  await options.onFinish({ usage: { inputTokens: 10, outputTokens: 5 }, text: "answer" });
  assert.ok(calls.logs.every((log) => log.reservationId === "reserved"));
  assert.deepEqual(calls.logs.map((log) => log.success), [false, false, true]);
});

test("nontext streaming input is rejected before reservation or provider", async () => {
  const { service, calls } = serviceHarness();
  await assert.rejects(service.stream({ ...base, messages: [{ role: "user", content: [{ type: "image", image: "https://example.test" }] }] }), /text messages/);
  assert.equal(calls.reservations.length, 0);
  assert.equal(calls.providers.length, 0);
});


test("all generation completions preserve unknown or partial usage", async () => {
  for (const reportedUsage of [{}, { inputTokens: 10 }, { outputTokens: 5 }]) {
    const { service, calls } = serviceHarness({ reportedUsage });
    assert.equal((await service.generate({ ...base, prompt: "hello" })).success, true);
    assert.equal((await service.generateStructured({ ...base, prompt: "hello", schema: z.object({ answer: z.string() }) })).success, true);
    const { options } = await service.stream({ ...base, messages: [{ role: "user", content: "hello" }] });
    await options.onFinish({ usage: reportedUsage, text: "answer" });
    assert.equal(calls.logs.length, 3);
    assert.ok(calls.logs.every((log) => log.usageKnown === false && log.success === true));
  }
});

test("settlement retains unknown allowance even on successful output", async () => {
  for (const usageKnown of [false, undefined, true]) {
    const updates = [];
    const tracker = loadModule("src/lib/ai/token-tracker.ts", {
      "@/lib/prisma": { prisma: { aIUsageLog: {
        findFirst: async () => ({ id: "reserved", reservedTokens: 60000, settledAt: null }),
        updateMany: async (input) => { updates.push(input); return { count: 1 }; },
      } } }, "./client": { calculateCost: () => 0 },
    });
    await tracker.logUsage({ ...base, reservationId: "reserved", endpoint: "/api/ai/chat", usageKnown, success: true,
      usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10, model: "test-model", latencyMs: 1 } });
    assert.equal(updates[0].data.reservedTokens, usageKnown === true ? 0 : 59990);
  }
});
