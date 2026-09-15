const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module.cjs");

const request = (method = "GET", body) => new Request("https://app.example.test/api/mentorship/relationship", { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
const params = { params: Promise.resolve({ mentorshipId: "relationship" }) };
const strength = (rank, slug = "achiever") => ({
  id: `strength-${rank}`, rank, theme: { name: slug, slug, shortDescription: "Public description", domain: { slug: "executing" } },
  personalizedDescription: "PRIVATE_DESCRIPTION", personalizedInsights: ["PRIVATE_INSIGHT"], strengthBlends: { value: "PRIVATE_BLEND" }, applySection: { value: "PRIVATE_APPLY" },
});
const actor = (id = "mentor", role = "MEMBER") => ({ user: { id: `user-${id}`, memberId: id, organizationId: "org-a", role } });
const relationship = (status = "PENDING") => ({
  id: "relationship", mentorId: "mentor", menteeId: "mentee", status,
  mentor: { id: "mentor", points: 25, organizationId: "org-a", user: { id: "user-mentor", fullName: "Mentor" }, strengths: [strength(1)] },
  mentee: { id: "mentee", points: 50, organizationId: "org-a", user: { id: "user-mentee", fullName: "Mentee" }, strengths: [strength(1)] },
});
const load = (prisma, session = actor()) => loadModule("src/app/api/mentorship/[mentorshipId]/route.ts", {
  "@/lib/prisma": { prisma }, "next-auth": { getServerSession: async () => session }, "@/lib/auth/config": { authOptions: {} },
  "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => {} },
});

for (const viewerId of ["mentor", "mentee"]) test(`mentorship detail lets ${viewerId} see their own personalized data and only the peer's basic strengths`, async () => {
  const route = load({ mentorship: { findFirst: async ({ where }) => {
    assert.deepEqual(where.mentor, { organizationId: "org-a", status: "ACTIVE" });
    assert.deepEqual(where.mentee, { organizationId: "org-a", status: "ACTIVE" });
    return relationship();
  } } }, actor(viewerId));
  const response = await route.GET(request(), params); assert.equal(response.status, 200);
  const data = (await response.json()).data;
  const peer = viewerId === "mentor" ? "mentee" : "mentor";
  assert.equal(data[viewerId].strengths[0].personalizedDescription, "PRIVATE_DESCRIPTION");
  for (const key of ["personalizedDescription", "personalizedInsights", "strengthBlends", "applySection"]) assert.equal(Object.hasOwn(data[peer].strengths[0], key), false);
  assert.equal(data[peer].strengths[0].theme.name, "achiever");
  assert.equal(data[peer].points, undefined);
});

test("manager participants retain authorized personalized strengths", async () => {
  const route = load({ mentorship: { findFirst: async () => relationship() } }, actor("mentor", "MANAGER"));
  const data = (await (await route.GET(request(), params)).json()).data;
  assert.equal(data.mentee.strengths[0].personalizedDescription, "PRIVATE_DESCRIPTION");
});

test("mentorship detail rejects a relationship without both active same-organization participants", async () => {
  const route = load({ mentorship: { findFirst: async ({ where }) => {
    assert.deepEqual(where.mentor, { organizationId: "org-a", status: "ACTIVE" });
    assert.deepEqual(where.mentee, { organizationId: "org-a", status: "ACTIVE" });
    assert.deepEqual(where.OR, [{ mentorId: "mentor" }, { menteeId: "mentor" }]);
    return null;
  } } });
  assert.equal((await route.GET(request(), params)).status, 404);
});

function transitionHarness(session = actor()) {
  let status = "PENDING", points = 0, notifications = 0;
  const tx = {
    mentorship: {
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where.mentor, { organizationId: "org-a", status: "ACTIVE" });
        assert.deepEqual(where.mentee, { organizationId: "org-a", status: "ACTIVE" });
        if (where.status !== status) return { count: 0 };
        status = data.status; return { count: 1 };
      },
      findFirst: async () => relationship(status),
    },
    notification: { create: async () => { notifications++; } },
    organizationMember: { updateMany: async ({ where, data }) => { assert.deepEqual(where, { id: "mentor", organizationId: "org-a", status: "ACTIVE" }); points += data.points.increment; return { count: 1 }; } },
  };
  const prisma = { mentorship: { findFirst: async () => relationship(status) }, $transaction: async (fn) => fn(tx) };
  return { route: load(prisma, session), state: () => ({ status, points, notifications }) };
}

test("racing mentorship accepts atomically award twenty points and notify exactly once", async () => {
  const h = transitionHarness();
  const results = await Promise.all([h.route.PATCH(request("PATCH", { action: "accept" }), params), h.route.PATCH(request("PATCH", { action: "accept" }), params)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(h.state(), { status: "ACTIVE", points: 20, notifications: 1 });
  assert.equal((await h.route.PATCH(request("PATCH", { action: "accept" }), params)).status, 400);
  assert.equal(h.state().points, 20);
});

test("a mentee cannot accept their own request or award mentor points", async () => {
  const h = transitionHarness(actor("mentee"));
  assert.equal((await h.route.PATCH(request("PATCH", { action: "accept" }), params)).status, 403);
  assert.deepEqual(h.state(), { status: "PENDING", points: 0, notifications: 0 });
});

test("pause and complete preserve legitimate transitions without acceptance rewards", async () => {
  const h = transitionHarness();
  for (const action of ["accept", "pause", "complete"]) assert.equal((await h.route.PATCH(request("PATCH", { action }), params)).status, 200);
  assert.deepEqual(h.state(), { status: "COMPLETED", points: 20, notifications: 3 });
});

for (const [role, viewer, limits, includesHidden] of [["MEMBER", "viewer", [5, 5], false], ["MEMBER", "one", [10, 5], false], ["MANAGER", "viewer", [10, 10], true]]) {
  test(`partnership guide honors ${role}/${viewer} access when deriving shared theme names`, async () => {
    const actualLimits = [];
    const route = loadModule("src/app/api/partnerships/guide/route.ts", {
      "next-auth": { getServerSession: async () => actor(viewer, role) }, "@/lib/auth/config": { authOptions: {} },
      "@/lib/prisma": { prisma: { organizationMember: { findFirst: async ({ where, include }) => {
        assert.equal(where.organizationId, "org-a"); assert.equal(where.status, "ACTIVE");
        const max = include.strengths.where.rank.lte; actualLimits.push(max);
        return { id: where.id, user: { fullName: "Test" }, strengths: [strength(1), strength(6, "HIDDEN_SIXTH_THEME")].filter((s) => s.rank <= max) };
      } } } },
    });
    const response = await route.GET(new Request("https://app.example.test/api/partnerships/guide?member1=one&member2=two"));
    assert.equal(response.status, 200);
    assert.deepEqual(actualLimits, limits);
    const data = (await response.json()).data;
    assert.equal(data.sharedStrengths.includes("HIDDEN_SIXTH_THEME"), includesHidden);
  });
}

test("bulk optional PDF completes before a write transaction starts", async () => {
  let parsing = false, parsed = false, writing = false;
  const member = { id: "new-member", userId: "new-user", organizationId: "org-a", role: "MEMBER", status: "PENDING", organization: { name: "Organization" } };
  const tx = {
    user: { create: async () => ({ id: "new-user", email: "new@example.test", fullName: "New User" }) },
    organizationMember: { create: async () => member, update: async () => member, findUniqueOrThrow: async () => member },
    strengthsDocument: { create: async () => ({ id: "document" }) }, memberStrength: { createMany: async () => ({ count: 1 }) },
  };
  const route = loadModule("src/app/api/admin/members/bulk/route.ts", {
    "next-auth": { getServerSession: async () => actor("owner", "OWNER") }, "@/lib/auth/config": { authOptions: {} },
    "@/lib/auth/request-protection": { protectAuthRequest: async () => {}, authProtectionResponse: () => null },
    "@/lib/auth/account-emails": { requireInvitationEmail: () => {}, sendMemberInvitation: async () => {} },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => null }, strengthTheme: { findMany: async () => [{ id: "theme", slug: "achiever" }] },
      $transaction: async (fn) => { assert.equal(parsing, false); assert.equal(parsed, true); writing = true; try { return await fn(tx); } finally { writing = false; } },
    } },
    "@/lib/pdf/parser": {
      parseCliftonStrengthsPDF: async () => { assert.equal(writing, false); parsing = true; await new Promise((resolve) => setTimeout(resolve, 10)); parsing = false; parsed = true; return { themes: [{ slug: "achiever", rank: 1 }] }; },
      validateParsedReport: () => ({ valid: true }),
    },
  });
  const form = new FormData(); form.set("members[0].email", "new@example.test"); form.set("members[0].fullName", "New User");
  form.set("members[0].pdf", new Blob(["synthetic"], { type: "application/pdf" }), "strengths.pdf");
  const response = await route.POST(new Request("https://app.example.test/api/admin/members/bulk", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.results[0].data.strengthsImported, true);
});
