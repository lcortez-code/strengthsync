const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./load-module.cjs");

const parameters = { params: Promise.resolve({ requestId: "request" }) };
const request = (method, body, responseId) => new Request(`http://localhost/api${responseId ? `?responseId=${responseId}` : ""}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const row = (id, status = "OFFERED", responderId = "helper") => ({
  id, requestId: "request", responderId, status, message: "Happy to help with this", createdAt: new Date(),
  responder: { user: { id: `${responderId}-user`, fullName: responderId } },
});

function fixture(initialResponses = []) {
  const state = {
    responses: initialResponses.map(value => ({ ...value })), points: {}, notices: 0, teams: 0,
    requestStatus: "OPEN", lockKeys: [], onTransaction: null,
  };
  const pendingLocks = new Map();
  const skillRequest = {
    findFirst: async ({ where }) => where.organizationId === "org" ? {
      id: "request", creatorId: "creator", status: state.requestStatus, title: "Help", urgency: "LOW",
      creator: { user: { id: "creator-user" } },
    } : null,
  };
  const findResponse = async ({ where }) => state.responses.find(value =>
    (!where.id || value.id === where.id) && value.requestId === where.requestId &&
    (!where.responderId || value.responderId === where.responderId) &&
    (!where.status || where.status.in.includes(value.status))) || null;
  const prisma = {
    skillRequest,
    skillRequestResponse: { findFirst: findResponse },
    notification: { create: async () => { state.notices++; } },
    $transaction: async callback => {
      let unlock;
      let locked = false;
      if (state.onTransaction) state.onTransaction();
      const assertLocked = () => assert.equal(locked, true, "writes and duplicate reads must hold the pair lock");
      const tx = {
        $executeRaw: async (query, key) => {
          assert.match(query.join("?"), /pg_advisory_xact_lock\(hashtextextended\(\?, 0\)\)/);
          const previous = pendingLocks.get(key) || Promise.resolve();
          const current = new Promise(resolve => { unlock = resolve; });
          pendingLocks.set(key, current);
          await previous;
          state.lockKeys.push(key);
          locked = true;
        },
        skillRequest: {
          updateMany: async ({ where, data }) => {
            assertLocked();
            assert.equal(where.organizationId, "org");
            assert.deepEqual(where.status.in, ["OPEN", "IN_PROGRESS"]);
            assert.notEqual(where.creatorId.not, "creator");
            if (!where.status.in.includes(state.requestStatus)) return { count: 0 };
            state.requestStatus = data.status;
            return { count: 1 };
          },
          update: async ({ data }) => { assertLocked(); state.requestStatus = data.status; },
        },
        skillRequestResponse: {
          findFirst: async args => { assertLocked(); return findResponse(args); },
          create: async ({ data }) => {
            assertLocked();
            const created = { ...row(`response-${state.responses.length + 1}`), ...data };
            state.responses.push(created);
            return created;
          },
          updateMany: async ({ where, data }) => {
            assertLocked();
            assert.equal(where.request.organizationId, "org");
            assert.equal(where.request.creatorId, "creator");
            const existing = state.responses.find(value => value.id === where.id && value.requestId === where.requestId && value.status === where.status);
            if (!existing) return { count: 0 };
            existing.status = data.status;
            return { count: 1 };
          },
        },
        organizationMember: { update: async ({ where, data }) => {
          assertLocked(); state.points[where.id] = (state.points[where.id] || 0) + data.points.increment;
        } },
      };
      try { return await callback(tx); } finally { if (unlock) unlock(); }
    },
  };
  const routeFor = (memberId = "helper", organizationId = "org") => loadModule("src/app/api/skill-requests/[requestId]/respond/route.ts", {
    "@/lib/prisma": { prisma }, "@/lib/auth/config": { authOptions: {} },
    "next-auth": { getServerSession: async () => ({ user: { id: `${memberId}-user`, memberId, organizationId, role: "MEMBER" } }) },
    "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => [] },
    "@/lib/integrations/teams-webhook": { sendTeamsNotification: async () => { state.teams++; }, buildSkillRequestCard: () => ({}) },
  });
  const offer = (memberId = "helper") => routeFor(memberId).POST(request("POST", { message: "Happy to help with this" }), parameters);
  const review = (responseId, status = "ACCEPTED", memberId = "creator") => routeFor(memberId).PATCH(request("PATCH", { status }, responseId), parameters);
  return { state, routeFor, offer, review };
}

test("simultaneous offers create one response and award the first response once", async () => {
  const { state, offer } = fixture();
  const results = await Promise.all([offer(), offer(), offer()]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409]);
  assert.equal(state.responses.length, 1);
  assert.equal(state.points.helper, 15);
  assert.equal(state.notices, 1);
  assert.equal(state.teams, 1);
  assert.equal(state.requestStatus, "IN_PROGRESS");
  assert.deepEqual(state.lockKeys, Array(3).fill('skill-response:["request","helper"]'));
  assert.equal((await offer()).status, 409);
});

for (const status of ["OFFERED", "DECLINED", "ACCEPTED", "COMPLETED"]) {
  test(`an existing ${status} response cannot earn another initial reward`, async () => {
    const { state, offer } = fixture([row("existing", status)]);
    assert.equal((await offer()).status, 409);
    assert.equal(state.responses.length, 1);
    assert.deepEqual(state.points, {});
    assert.equal(state.notices, 0);
  });
}

test("historical duplicate rows can be accepted only once per request and helper", async () => {
  const { state, review } = fixture([row("first"), row("duplicate")]);
  const results = await Promise.all([review("first"), review("duplicate")]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(state.responses.filter(value => value.status === "ACCEPTED").length, 1);
  assert.equal(state.points.helper, 25);
  assert.equal(state.notices, 1);
  const offered = state.responses.find(value => value.status === "OFFERED");
  assert.equal((await review(offered.id, "DECLINED")).status, 200);
  assert.equal((await review(offered.id)).status, 409);
  assert.equal(state.points.helper, 25);
});

for (const status of ["ACCEPTED", "COMPLETED"]) {
  test(`a historical ${status} sibling prevents another acceptance reward`, async () => {
    const { state, review } = fixture([row("earlier", status), row("duplicate")]);
    assert.equal((await review("duplicate")).status, 409);
    assert.equal(state.responses[1].status, "OFFERED");
    assert.deepEqual(state.points, {});
    assert.equal(state.notices, 0);
  });
}

test("offer and acceptance use the same lock while different helpers remain eligible", async () => {
  const { state, offer, review } = fixture([row("first"), row("other", "OFFERED", "second-helper")]);
  const results = await Promise.all([offer(), review("first")]);
  assert.deepEqual(results.map(result => result.status), [409, 200]);
  assert.deepEqual(state.lockKeys, Array(2).fill('skill-response:["request","helper"]'));
  assert.equal((await review("other")).status, 200);
  assert.deepEqual(state.points, { helper: 25, "second-helper": 25 });
});

test("a request closed after authorization is never reopened by an offer", async () => {
  const { state, offer } = fixture();
  state.onTransaction = () => { state.requestStatus = "FULFILLED"; };
  assert.equal((await offer()).status, 400);
  assert.equal(state.requestStatus, "FULFILLED");
  assert.equal(state.responses.length, 0);
  assert.deepEqual(state.points, {});
});

test("response changes preserve creator-only and tenant boundaries", async () => {
  const { state, routeFor, offer, review } = fixture([row("first")]);
  assert.equal((await offer("creator")).status, 400);
  assert.equal((await review("first", "ACCEPTED", "helper")).status, 403);
  assert.equal((await routeFor("outsider", "foreign-org").PATCH(request("PATCH", { status: "ACCEPTED" }, "first"), parameters)).status, 404);
  assert.equal(state.lockKeys.length, 0);
  assert.deepEqual(state.points, {});
});
