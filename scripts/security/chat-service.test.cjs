const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module.cjs");

function harness() {
  const state = {
    member: { id: "member", organizationId: "org", status: "ACTIVE" },
    conversation: { id: "conversation", memberId: "member", organizationId: "org", status: "ACTIVE" },
    messages: [{ role: "USER", content: "Question" }, { role: "ASSISTANT", content: "Answer" }],
    writes: [], creations: 0, providers: 0, reads: 0, inTransaction: false,
    beforeTransaction: null, beforeRead: null, failInsert: false, updates: 0,
  };
  function matches(where) {
    assert.deepEqual(where.member, { organizationId: "org", status: "ACTIVE" });
    return state.conversation && ["id", "memberId", "organizationId", "status"].every((key) => where[key] === state.conversation[key]) &&
      state.member.id === where.memberId && state.member.organizationId === where.member.organizationId && state.member.status === where.member.status;
  }
  const prisma = {
    aIConversation: {
      findFirst: async ({ where }) => matches(where) ? { id: state.conversation.id } : null,
      create: async ({ data }) => {
        assert.equal(state.inTransaction, true);
        state.creations += 1;
        state.conversation = { id: `created-${state.creations}`, status: "ACTIVE", ...data };
        return { id: state.conversation.id };
      },
      updateMany: async ({ where }) => {
        assert.equal(state.inTransaction, true);
        if (!matches(where)) return { count: 0 };
        state.updates += 1;
        return { count: 1 };
      },
    },
    aIMessage: {
      findMany: async ({ where, select }) => {
        state.reads += 1;
        if (state.beforeRead) state.beforeRead();
        assert.deepEqual(select, { role: true, content: true });
        return where.conversationId === state.conversation?.id && matches(where.conversation) ? state.messages : [];
      },
      create: async ({ data }) => {
        assert.equal(state.inTransaction, true);
        if (state.failInsert) throw new Error("insert failed");
        state.writes.push(data);
        state.messages.push({ role: data.role, content: data.content });
      },
    },
    $queryRaw: async (query, memberId, organizationId) => {
      assert.equal(state.inTransaction, true);
      assert.match(query.join("?"), /FOR SHARE/);
      return state.member.id === memberId && state.member.organizationId === organizationId && state.member.status === "ACTIVE" ? [{ id: memberId }] : [];
    },
    $transaction: async (callback) => {
      if (state.beforeTransaction) state.beforeTransaction();
      const snapshot = { conversation: state.conversation && { ...state.conversation }, messages: [...state.messages], writes: [...state.writes], updates: state.updates };
      state.inTransaction = true;
      try { return await callback(prisma); }
      catch (error) { Object.assign(state, snapshot); throw error; }
      finally { state.inTransaction = false; }
    },
  };
  const service = loadModule("src/lib/ai/service.ts", {
    "@/lib/prisma": { prisma }, "./prompts": {},
    ai: { streamText: (options) => { state.providers += 1; return { options }; } },
    "./client": { openai: () => "test-model", getFeatureSettings: () => ({ model: "test-model", maxTokens: 500, temperature: 0.5 }), isAIConfigured: () => true },
    "./rate-limiter": { estimateTokenAllowance: () => 1000, reserveAIRequest: async () => ({ allowed: true, reservationId: "reservation" }) },
    "./token-tracker": { logUsage: async () => {} },
  });
  return { state, service, chat: new service.ChatService("member", "org", "conversation") };
}

for (const [name, change] of [
  ["another member", (s) => { s.conversation.memberId = "another-member"; }],
  ["another organization", (s) => { s.conversation.organizationId = "another-org"; }],
  ["archived conversation", (s) => { s.conversation.status = "ARCHIVED"; }],
  ["deleted conversation", (s) => { s.conversation.status = "DELETED"; }],
  ["missing conversation", (s) => { s.conversation = null; }],
  ["inactive membership", (s) => { s.member.status = "INACTIVE"; }],
  ["pending membership", (s) => { s.member.status = "PENDING"; }],
  ["reassigned membership", (s) => { s.member.organizationId = "another-org"; }],
]) {
  test(`constructor conversation denies ${name} on every entry point`, async () => {
    const { state, chat } = harness();
    change(state);
    for (const action of [() => chat.getOrCreateConversation(), () => chat.getMessages(), () => chat.saveMessage("USER", "x"), () => chat.saveAssistantResponse("x"), () => chat.streamChat("x")]) {
      await assert.rejects(action(), /unavailable|membership/);
    }
    assert.equal(state.reads, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(state.creations, 0);
    assert.equal(state.providers, 0);
  });
}

test("active owner can read history and persist a reply with usage", async () => {
  const { chat, state } = harness();
  assert.deepEqual(await chat.getMessages(), [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }]);
  await chat.saveAssistantResponse("Follow-up", { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: "test-model", latencyMs: 20 });
  assert.deepEqual(state.writes, [{ conversationId: "conversation", role: "ASSISTANT", content: "Follow-up", promptTokens: 10, completionTokens: 5, totalTokens: 15, model: "test-model", latencyMs: 20 }]);
  assert.equal(state.updates, 1);
});

test("new conversation requires active membership in the supplied organization", async () => {
  for (const change of [(s) => { s.member.status = "INACTIVE"; }, (s) => { s.member.organizationId = "another-org"; }, (s) => { s.member.id = "another-member"; }]) {
    const { state, service } = harness();
    change(state);
    const chat = service.createChatService("member", "org");
    assert.deepEqual(await chat.getMessages(), []);
    await assert.rejects(chat.saveMessage("USER", "Question"), /membership/);
    assert.equal(state.creations, 0);
    assert.equal(state.writes.length, 0);
  }
});

test("concurrent creation on one service creates one owned conversation", async () => {
  const { state, service } = harness();
  const chat = service.createChatService("member", "org");
  const ids = await Promise.all(Array.from({ length: 12 }, () => chat.getOrCreateConversation("Topic")));
  assert.equal(new Set(ids).size, 1);
  assert.equal(state.creations, 1);
  assert.equal(state.conversation.title, "Topic");
  await chat.saveMessage("USER", "New question");
  assert.equal(state.writes[0].conversationId, ids[0]);
});

test("creation retries after a denied membership check", async () => {
  const { state, service } = harness();
  const chat = service.createChatService("member", "org");
  state.member.status = "INACTIVE";
  await assert.rejects(chat.getOrCreateConversation(), /membership/);
  state.member.status = "ACTIVE";
  assert.equal(await chat.getOrCreateConversation(), "created-1");
});

test("revocation or conversation change between precheck and persistence prevents append", async () => {
  for (const change of [(s) => { s.member.status = "INACTIVE"; }, (s) => { s.conversation.status = "DELETED"; }, (s) => { s.conversation.memberId = "another-member"; }]) {
    const { state, chat } = harness();
    state.beforeTransaction = () => change(state);
    await assert.rejects(chat.saveMessage("USER", "Question"), /unavailable|membership/);
    assert.equal(state.writes.length, 0);
    assert.equal(state.updates, 0);
  }
});

test("history query cannot leak messages if membership is revoked after precheck", async () => {
  const { state, chat } = harness();
  state.beforeRead = () => { state.member.status = "INACTIVE"; };
  assert.deepEqual(await chat.getMessages(), []);
});

test("assistant completion cannot append after access is removed during streaming", async () => {
  const { state, chat } = harness();
  await chat.streamChat("Follow-up question");
  assert.equal(state.providers, 1);
  assert.equal(state.writes.length, 1);
  state.member.status = "INACTIVE";
  await assert.rejects(chat.saveAssistantResponse("Private answer"), /unavailable/);
  assert.equal(state.writes.length, 1);
});

test("failed message insert rolls back the conversation update", async () => {
  const { state, chat } = harness();
  state.failInsert = true;
  await assert.rejects(chat.saveMessage("USER", "Question"), /insert failed/);
  assert.equal(state.updates, 0);
  assert.equal(state.writes.length, 0);
});
