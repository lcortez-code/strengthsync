const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./load-module.cjs");

const user = { id: "user-a", memberId: "member-a", organizationId: "org-a", role: "MEMBER" };
const req = (method = "GET", body, query = "") => new Request(`http://localhost/api${query}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
const params = values => ({ params: Promise.resolve(values) });
function load(path, prisma, overrides = {}) {
  return loadModule(`src/app/api/${path}/route.ts`, {
    "@/lib/prisma": { prisma }, "@/lib/auth/config": { authOptions: {} },
    "next-auth": { getServerSession: async () => ({ user }) },
    "@/lib/ai": { checkAIReady: () => ({ ready: false }) },
    "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => [] },
    "@/lib/integrations/teams-webhook": { sendTeamsNotification: async () => {}, buildShoutoutCard: () => ({}), buildSkillRequestCard: () => ({}) },
    ...overrides,
  });
}

for (const isPublic of [false, true]) {
  test(`${isPublic ? "public" : "private"} shoutout respects publication while preserving recipient notification`, async () => {
    const effects = { feed: 0, teams: 0, recipient: 0 };
    const prisma = {
      organizationMember: { findFirst: async () => ({ id: "receiver" }), update: async () => ({}) },
      shoutout: { create: async ({ data }) => ({ ...data, id: "shoutout", createdAt: new Date(), giver: { user: { fullName: "Giver" } }, receiver: { user: { id: "recipient", fullName: "Receiver" } }, theme: null }) },
      feedItem: { create: async () => { effects.feed++; } },
      notification: { create: async () => { effects.recipient++; } },
      $transaction: async tasks => Promise.all(tasks),
    };
    const route = load("shoutouts", prisma, { "@/lib/integrations/teams-webhook": {
      sendTeamsNotification: async () => { effects.teams++; }, buildShoutoutCard: () => ({}),
    } });
    const response = await route.POST(req("POST", { receiverId: "receiver", message: "Thanks for your careful review", isPublic }));
    assert.equal(response.status, 201);
    assert.equal(effects.feed, isPublic ? 1 : 0);
    assert.equal(effects.teams, isPublic ? 1 : 0);
    assert.equal(effects.recipient, 1);
  });
}

function permitsFeed(where, item) {
  if (where.organizationId !== item.organizationId) return false;
  return where.OR?.some(branch => (Object.hasOwn(branch, "shoutoutId") && item.shoutoutId === branch.shoutoutId) || (branch.shoutout?.isPublic === true && item.shoutout?.isPublic === true));
}

test("feed list excludes historical private shoutouts including copied message content", async () => {
  const privateItem = { id: "private-feed", organizationId: "org-a", shoutoutId: "private-shoutout", shoutout: { isPublic: false }, content: { message: "private text" } };
  const prisma = { feedItem: {
    count: async ({ where }) => permitsFeed(where, privateItem) ? 1 : 0,
    findMany: async ({ where }) => {
      assert.equal(permitsFeed(where, privateItem), false);
      assert.equal(permitsFeed(where, { organizationId: "org-a", shoutoutId: null }), true);
      assert.equal(permitsFeed(where, { ...privateItem, shoutout: { isPublic: true } }), true);
      return [];
    },
  } };
  const response = await load("feed", prisma).GET(req());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, 0);
  assert.deepEqual(body.data, []);
});

for (const item of [
  { id: "private-feed", organizationId: "org-a", shoutoutId: "private", shoutout: { isPublic: false } },
  { id: "foreign-feed", organizationId: "org-b", shoutoutId: null },
]) {
  for (const [path, method, body] of [
    ["feed/[feedItemId]/comments", "GET", undefined],
    ["feed/[feedItemId]/comments", "POST", { content: "hello" }],
    ["feed/[feedItemId]/comments", "DELETE", undefined],
    ["feed/[feedItemId]/reactions", "POST", { emoji: "like" }],
    ["feed/[feedItemId]/reactions", "DELETE", undefined],
  ]) {
    test(`${method} ${path} denies ${item.id} to an unrelated admin`, async () => {
      let writes = 0;
      const prisma = {
        feedItem: { findFirst: async ({ where }) => permitsFeed(where, item) ? item : null },
        comment: {
          findFirst: async ({ where }) => permitsFeed(where.feedItem, item) ? { id: "comment", authorId: "victim" } : null,
          deleteMany: async () => { writes++; }, create: async () => { writes++; },
        },
        reaction: {
          findFirst: async ({ where }) => permitsFeed(where.feedItem, item) ? { id: "reaction" } : null,
          deleteMany: async () => { writes++; }, create: async () => { writes++; },
        },
      };
      const route = load(path, prisma, { "next-auth": { getServerSession: async () => ({ user: { ...user, role: "ADMIN" } }) } });
      const response = await route[method](req(method, body, "?commentId=comment"), params({ feedItemId: item.id }));
      assert.equal(response.status, 404);
      assert.equal(writes, 0);
    });
  }
}

test("same-tenant admin can delete a public comment with tenant scope retained in the write", async () => {
  let deleted = false;
  const prisma = { comment: {
    findFirst: async () => ({ id: "comment", authorId: "peer" }),
    deleteMany: async ({ where }) => {
      assert.equal(where.feedItem.organizationId, "org-a"); assert.equal(where.feedItemId, "feed");
      deleted = true; return { count: 1 };
    },
  } };
  const route = load("feed/[feedItemId]/comments", prisma, { "next-auth": { getServerSession: async () => ({ user: { ...user, role: "ADMIN" } }) } });
  assert.equal((await route.DELETE(req("DELETE", undefined, "?commentId=comment"), params({ feedItemId: "feed" }))).status, 200);
  assert.equal(deleted, true);
});

function reviewFixture() {
  const date = new Date();
  const goal = { id: "goal", reviewId: "review", title: "A goal", managerRating: "EXCEEDED", selfRating: null, createdAt: date, dueDate: null, alignedThemes: [], status: "IN_PROGRESS", progress: 50 };
  const review = {
    id: "review", memberId: "member-a", reviewerId: "reviewer", status: "MANAGER_REVIEW", createdAt: date,
    cycle: { id: "cycle", organizationId: "org-a", name: "Cycle", startsAt: date, endsAt: date, status: "ACTIVE", includeSelfAssessment: true, includeManagerReview: true },
    member: { id: "member-a", user: { fullName: "Subject" }, strengths: [] },
    reviewer: { id: "reviewer", user: { fullName: "Reviewer" } }, goals: [goal], evidence: [],
  };
  const prisma = { performanceReview: { findFirst: async () => review, updateMany: async () => ({ count: 1 }) }, reviewGoal: { findFirst: async () => goal, update: async () => goal } };
  prisma.$transaction = async work => work(prisma);
  return { prisma, review };
}

for (const memberId of ["member-a", "reviewer"]) {
  test(`review and goal reads/updates share rating visibility for ${memberId}`, async () => {
    const { prisma, review } = reviewFixture();
    if (memberId === "member-a") review.status = "SELF_ASSESSMENT";
    const overrides = { "next-auth": { getServerSession: async () => ({ user: { ...user, memberId } }) } };
    const main = load("reviews/[reviewId]", prisma, overrides);
    const goals = load("reviews/[reviewId]/goals", prisma, overrides);
    const p = params({ reviewId: "review" });
    const mainBody = await (await main.GET(req(), p)).json();
    const goalsBody = await (await goals.GET(req(), p)).json();
    const updateBody = await (await goals.PATCH(req("PATCH", { progress: 50 }, "?goalId=goal"), p)).json();
    const expected = memberId === "reviewer" ? "EXCEEDED" : null;
    assert.equal(mainBody.data.goals[0].managerRating, expected);
    assert.equal(goalsBody.data.goals[0].managerRating, expected);
    assert.equal(updateBody.data.managerRating, expected);
  });
}

test("reviewer assignment rejects foreign or inactive members before writing", async () => {
  const { prisma } = reviewFixture();
  let writes = 0;
  prisma.organizationMember = { findFirst: async ({ where }) => {
    assert.equal(where.organizationId, "org-a"); assert.equal(where.status, "ACTIVE"); return null;
  } };
  prisma.performanceReview.update = async () => { writes++; };
  const route = load("reviews/[reviewId]", prisma, { "next-auth": { getServerSession: async () => ({ user: { ...user, role: "ADMIN" } }) } });
  assert.equal((await route.PATCH(req("PATCH", { reviewerId: "foreign" }), params({ reviewId: "review" }))).status, 404);
  assert.equal(writes, 0);
});

test("review evidence collection does not automatically share the subject's private shoutouts with a reviewer", async () => {
  const { prisma } = reviewFixture();
  let reads = 0;
  prisma.shoutout = { findMany: async ({ where }) => {
    reads++;
    assert.equal(where.organizationId, "org-a");
    assert.deepEqual(where.OR, [{ isPublic: true }, { giverId: "reviewer" }, { receiverId: "reviewer" }]);
    return [];
  } };
  prisma.skillRequestResponse = { findMany: async () => [] };
  prisma.badgeEarned = { findMany: async () => [] };
  prisma.mentorship = { findMany: async () => [] };
  const route = load("reviews/[reviewId]/evidence", prisma, { "next-auth": { getServerSession: async () => ({ user: { ...user, memberId: "reviewer" } }) } });
  const response = await route.GET(req(), params({ reviewId: "review" }));
  assert.equal(response.status, 200);
  assert.equal(reads, 2);
  assert.deepEqual((await response.json()).data.available.shoutoutsReceived, []);
});

test("concurrent/replayed skill response acceptance awards points and notification once", async () => {
  let state = "OFFERED", points = 0, notices = 0, transactions = 0;
  const prisma = {
    skillRequest: { findFirst: async () => ({ id: "request", creatorId: "member-a", title: "Help" }), update: async () => ({}) },
    skillRequestResponse: {
      findFirst: async ({ where }) => {
        if (where.status && !where.status.in.includes(state)) return null;
        return { id: "response", responderId: "peer", responder: { user: { id: "peer-user", fullName: "Peer" } }, status: state };
      },
      updateMany: async ({ where, data }) => {
        assert.equal(where.request.organizationId, "org-a"); assert.equal(where.request.creatorId, "member-a");
        assert.equal(where.status, "OFFERED");
        if (state !== where.status) return { count: 0 };
        state = data.status; return { count: 1 };
      },
    },
    organizationMember: { update: async ({ data }) => { points += data.points.increment; } },
    notification: { create: async () => { notices++; } },
    $executeRaw: async (_query, key) => { assert.equal(key, 'skill-response:["request","peer"]'); },
    $transaction: async callback => { transactions++; return callback(prisma); },
  };
  const route = load("skill-requests/[requestId]/respond", prisma);
  const invoke = () => route.PATCH(req("PATCH", { status: "ACCEPTED" }, "?responseId=response"), params({ requestId: "request" }));
  const responses = await Promise.all([invoke(), invoke(), invoke()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409, 409]);
  assert.equal(points, 25); assert.equal(notices, 1); assert.equal(transactions, 3);
  assert.equal((await invoke()).status, 409);
  assert.equal(points, 25);
});
