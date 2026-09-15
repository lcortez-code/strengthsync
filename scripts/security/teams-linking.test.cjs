const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { loadModule } = require("./load-module.cjs");

const tenant = "11111111-1111-1111-1111-111111111111";
const aad = "22222222-2222-2222-2222-222222222222";
const previous = Object.fromEntries(["MICROSOFT_APP_TENANT_ID", "MICROSOFT_APP_ID", "MICROSOFT_APP_PASSWORD", "NEXTAUTH_URL"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { MICROSOFT_APP_TENANT_ID: tenant, MICROSOFT_APP_ID: "synthetic-app", MICROSOFT_APP_PASSWORD: "synthetic-only", NEXTAUTH_URL: "https://strengthsync.test" });
test.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const identity = { tenantId: tenant, teamsUserId: aad, conversationId: "personal-chat", displayName: "Synthetic Teammate" };
const activity = () => ({ type: "message", channelId: "msteams", text: "/requests", channelData: { tenant: { id: tenant } }, from: { aadObjectId: aad, id: "untrusted-fallback", name: identity.displayName }, conversation: { id: identity.conversationId, conversationType: "personal", tenantId: tenant } });

function fixture() {
  let state = { challenges: [], mappings: [], members: [
    { id: "member-a", userId: "user-a", organizationId: "org-a", status: "ACTIVE", organization: { name: "Organization A" } },
    { id: "member-b", userId: "user-a", organizationId: "org-b", status: "ACTIVE", organization: { name: "Organization B" } },
  ] };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => value && typeof value === "object" && "gt" in value ? row[key] > value.gt : row[key] === value);
  let queue = Promise.resolve();
  const prisma = {
    $executeRaw: async () => 1,
    $transaction: async (fn) => {
      const before = queue;
      let done;
      queue = new Promise((resolve) => { done = resolve; });
      await before;
      const snapshot = structuredClone(state);
      try { return await fn(prisma); } catch (error) { state = snapshot; throw error; } finally { done(); }
    },
    teamsLinkChallenge: {
      upsert: async ({ create, update }) => {
        let row = state.challenges.find((entry) => entry.teamsUserId === create.teamsUserId && entry.teamsTenantId === create.teamsTenantId);
        if (row) Object.assign(row, update); else { row = { id: "challenge", ...create }; state.challenges.push(row); }
        return structuredClone(row);
      },
      findUnique: async ({ where }) => structuredClone(state.challenges.find((row) => matches(row, where)) || null),
      updateMany: async ({ where, data }) => { const rows = state.challenges.filter((row) => matches(row, where)); for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
      deleteMany: async ({ where }) => { state.challenges = state.challenges.filter((row) => !matches(row, where)); },
    },
    teamsUserMapping: {
      findUnique: async ({ where }) => structuredClone(state.mappings.find((row) => matches(row, where)) || null),
      findFirst: async ({ where }) => structuredClone(state.mappings.find((row) => matches(row, where)) || null),
      findMany: async ({ where }) => structuredClone(state.mappings.filter((row) => matches(row, where))),
      upsert: async ({ where, create, update }) => {
        let row = state.mappings.find((entry) => matches(entry, where));
        if (row) Object.assign(row, update); else { row = { id: "mapping", ...create }; state.mappings.push(row); }
        return structuredClone(row);
      },
      deleteMany: async ({ where }) => { state.mappings = state.mappings.filter((row) => !matches(row, where)); },
    },
    organizationMember: {
      findFirst: async ({ where }) => structuredClone(state.members.find((row) => matches(row, where)) || null),
      findMany: async ({ where }) => structuredClone(state.members.filter((row) => matches(row, where))),
    },
  };
  const helpers = loadModule("src/lib/integrations/teams-linking.ts", { "@/lib/prisma": { prisma } });
  return { helpers, prisma, state: () => state, issue: async () => new URLSearchParams(new URL(await helpers.createTeamsLinkChallenge(identity)).hash.slice(1)).get("token") };
}

test("Teams identity requires the configured tenant, Aad identity and personal Teams channel", () => {
  const { identifyTeamsActivity } = loadModule("src/lib/integrations/teams-identity.ts");
  assert.deepEqual(identifyTeamsActivity(activity()), identity);
  for (const change of [
    (a) => { a.channelId = "emulator"; },
    (a) => { a.channelData.tenant.id = "33333333-3333-3333-3333-333333333333"; },
    (a) => { delete a.channelData.tenant; },
    (a) => { delete a.from.aadObjectId; },
    (a) => { a.from.aadObjectId = "not-an-aad-id"; },
    (a) => { a.conversation.conversationType = "channel"; },
    (a) => { a.conversation.conversationType = "groupChat"; },
    (a) => { a.conversation.tenantId = "foreign"; },
    (a) => { a.from.role = "bot"; },
  ]) { const supplied = activity(); change(supplied); assert.equal(identifyTeamsActivity(supplied), null); }
});

test("challenges store a hash, expire after ten minutes, and use URL fragments", async () => {
  const f = fixture(); const before = Date.now(); const token = await f.issue();
  assert.equal(token.length, 64);
  assert.equal(f.state().challenges[0].tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.equal(JSON.stringify(f.state()).includes(token), false);
  assert.ok(f.state().challenges[0].expiresAt.getTime() >= before + 600000);
  assert.deepEqual(await f.helpers.reviewTeamsLink(token, "user-a"), { displayName: identity.displayName, expiresAt: f.state().challenges[0].expiresAt });
});

test("explicit organization selection wins when a user has multiple memberships", async () => {
  const f = fixture(); const token = await f.issue();
  await f.helpers.acceptTeamsLink(token, "user-a", "org-b");
  assert.equal(f.state().mappings[0].organizationId, "org-b");
  assert.equal(f.state().mappings[0].teamsTenantId, tenant);
  assert.ok(f.state().mappings[0].verifiedAt);
  assert.equal((await f.helpers.getTeamsLinkStatus("user-a")).links[0].active, true);
});

test("expired, replaced and replayed tokens cannot link an account", async () => {
  const f = fixture(); const first = await f.issue(); const latest = await f.issue();
  await assert.rejects(f.helpers.acceptTeamsLink(first, "user-a", "org-a"), /invalid or expired/);
  f.state().challenges[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(f.helpers.acceptTeamsLink(latest, "user-a", "org-a"), /invalid or expired/);
  const fresh = await f.issue();
  await f.helpers.acceptTeamsLink(fresh, "user-a", "org-a");
  await assert.rejects(f.helpers.acceptTeamsLink(fresh, "user-a", "org-a"), /invalid or expired/);
});

test("concurrent consumption admits only one link", async () => {
  const f = fixture(); const token = await f.issue();
  const results = await Promise.allSettled([f.helpers.acceptTeamsLink(token, "user-a", "org-a"), f.helpers.acceptTeamsLink(token, "user-a", "org-b")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.state().mappings.length, 1);
});

test("foreign or inactive organization cannot consume a challenge", async () => {
  const f = fixture(); const token = await f.issue();
  await assert.rejects(f.helpers.acceptTeamsLink(token, "user-a", "foreign"), /active/);
  f.state().members[0].status = "INACTIVE";
  await assert.rejects(f.helpers.acceptTeamsLink(token, "user-a", "org-a"), /active/);
  assert.equal(f.state().challenges[0].consumedAt, null);
  assert.equal(f.state().mappings.length, 0);
});

test("linking cannot replace another account's mapping", async () => {
  const f = fixture(); const token = await f.issue();
  f.state().mappings.push({ id: "other-link", teamsUserId: aad, userId: "other-user", organizationId: "other-org" });
  await assert.rejects(f.helpers.reviewTeamsLink(token, "user-a"), /another account/);
  await assert.rejects(f.helpers.acceptTeamsLink(token, "user-a", "org-a"), /another account/);
  assert.equal(f.state().mappings[0].userId, "other-user");
  assert.equal(f.state().challenges[0].consumedAt, null);
});

test("legacy links stay inactive until their owner relinks, and unlink invalidates outstanding challenges", async () => {
  const f = fixture();
  f.state().mappings.push({ id: "legacy", teamsUserId: aad, userId: "user-a", organizationId: "org-a", teamsTenantId: null, verifiedAt: null });
  assert.equal((await f.helpers.getTeamsLinkStatus("user-a")).links[0].active, false);
  await f.helpers.acceptTeamsLink(await f.issue(), "user-a", "org-b");
  const outstanding = await f.issue();
  await assert.rejects(f.helpers.unlinkTeamsAccount("legacy", "foreign-user"), /not found/);
  await f.helpers.unlinkTeamsAccount("legacy", "user-a");
  assert.equal(f.state().mappings.length, 0);
  await assert.rejects(f.helpers.acceptTeamsLink(outstanding, "user-a", "org-b"), /invalid or expired/);
});

test("bot resolves only its explicit verified organization and rejects revoked, legacy or different-conversation links", async () => {
  let mapping = { userId: "user-a", organizationId: "linked-org", teamsTenantId: tenant, verifiedAt: new Date(), teamsChannelId: identity.conversationId, user: { fullName: "Test" } };
  let active = true; let reads = 0; const membershipQueries = [];
  const { handleTeamsBotCommand } = loadModule("src/lib/integrations/teams-bot-handlers.ts", {
    "@/lib/prisma": { prisma: {
      teamsUserMapping: { findUnique: async () => mapping },
      organizationMember: { findFirst: async ({ where }) => { membershipQueries.push(where); return active ? { id: "linked-member", organizationId: where.organizationId } : null; } },
      skillRequest: { findMany: async ({ where }) => { assert.equal(where.organizationId, "linked-org"); reads++; return []; } },
    } },
    "@/lib/integrations/teams-linking": { createTeamsLinkChallenge: async () => "https://strengthsync.test/auth/teams-link#synthetic" },
    "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => {} },
  });
  await handleTeamsBotCommand(identity, "/requests");
  assert.deepEqual(membershipQueries[0], { userId: "user-a", organizationId: "linked-org", status: "ACTIVE" });
  assert.equal(reads, 1);
  active = false; await handleTeamsBotCommand(identity, "/requests");
  active = true; mapping.verifiedAt = null; await handleTeamsBotCommand(identity, "/requests");
  mapping.verifiedAt = new Date(); mapping.teamsChannelId = "another-chat"; await handleTeamsBotCommand(identity, "/requests");
  mapping.teamsChannelId = identity.conversationId; mapping.teamsTenantId = "foreign"; await handleTeamsBotCommand(identity, "/requests");
  assert.equal(reads, 1);
});

test("bot route never reaches handlers before adapter authentication or for another channel/tenant", async () => {
  let handled = 0; let authChecks = 0;
  class ActivityHandler { onMessage(fn) { this.message = fn; } onMembersAdded() {} async run(context) { await this.message(context, async () => {}); } }
  class CloudAdapter { async process(request, response, logic) {
    authChecks++;
    if (request.headers.authorization !== "Bearer synthetic-valid") throw Object.assign(new Error("Rejected"), { statusCode: 401 });
    await logic({ activity: request.body, sendActivity: async () => {} });
  } }
  const { POST } = loadModule("src/app/api/integrations/teams-bot/route.ts", {
    botbuilder: { CloudAdapter, ActivityHandler, ConfigurationBotFrameworkAuthentication: class {}, CardFactory: { adaptiveCard: (card) => card } },
    "@/lib/integrations/teams-bot-handlers": { handleTeamsBotCommand: async () => { handled++; return {}; } },
  });
  const send = (body, authorization) => POST(new Request("https://strengthsync.test/api/integrations/teams-bot", { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) }));
  assert.equal((await send(activity())).status, 401);
  assert.equal(authChecks, 0);
  assert.equal((await send(activity(), "Bearer forged")).status, 401);
  assert.equal(handled, 0);
  for (const change of [(a) => { a.channelId = "emulator"; }, (a) => { a.channelData.tenant.id = "foreign"; }, (a) => { a.conversation.conversationType = "channel"; }]) {
    const body = activity(); change(body); assert.equal((await send(body, "Bearer synthetic-valid")).status, 200);
  }
  assert.equal(handled, 0);
  assert.equal((await send(activity(), "Bearer synthetic-valid")).status, 200);
  assert.equal(handled, 1);
  const longMessage = activity(); longMessage.text = "x".repeat(2001);
  await send(longMessage, "Bearer synthetic-valid");
  assert.equal(handled, 1);
});

test("link API denies unauthenticated, cross-origin and client-supplied identity requests", async () => {
  let user = null; let accepted = 0;
  const route = loadModule("src/app/api/integrations/teams-link/route.ts", {
    "next-auth": { getServerSession: async () => user ? { user: { id: user } } : null },
    "@/lib/auth/config": { authOptions: {} },
    "@/lib/integrations/teams-linking": { TeamsLinkError: class extends Error {}, acceptTeamsLink: async () => { accepted++; return {}; }, getTeamsLinkStatus: async () => ({}), reviewTeamsLink: async () => ({}), unlinkTeamsAccount: async () => {} },
  });
  const send = (body, origin = "https://strengthsync.test") => route.POST(new Request("https://strengthsync.test/api/integrations/teams-link", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const body = { action: "link", token: "a".repeat(64), organizationId: "org-a" };
  assert.equal((await send(body)).status, 401);
  user = "user-a";
  assert.equal((await send(body, "https://attacker.test")).status, 403);
  assert.equal((await send({ ...body, teamsUserId: aad })).status, 400);
  assert.equal(accepted, 0);
  const result = await send(body);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(accepted, 1);
});

test("Teams JSON rejects oversized chunked bodies and malformed content", async () => {
  const { readTeamsJson } = loadModule("src/lib/integrations/teams-request.ts");
  await assert.rejects(readTeamsJson(new Request("https://test", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(20) }), 10), /too large/);
  await assert.rejects(readTeamsJson(new Request("https://test", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), /Invalid JSON/);
});
