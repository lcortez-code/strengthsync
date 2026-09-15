const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module.cjs");

const period = { start: new Date("2026-09-01"), end: new Date("2026-09-07") };
const admin = { user: { id: "user-a", memberId: "member-a", organizationId: "org-a", role: "ADMIN", email: "a@example.test" } };
const eligible = [
  { userId: "user-a", memberId: "member-a", organizationId: "org-a", userEmail: "a@example.test", organizationName: "A" },
  { userId: "user-b", memberId: "member-b", organizationId: "org-b", userEmail: "b@example.test", organizationName: "B" },
  { userId: "user-a", memberId: "member-a-other", organizationId: "org-b", userEmail: "a@example.test", organizationName: "B" },
];

function setup({ session = null, sentAlready = false, denyTest = false } = {}) {
  const calls = { queries: [], data: [], sends: [], limits: [] };
  // Exercise the actual recipient selector; only its database boundary is replaced.
  const service = loadModule("src/lib/email/digest-service.ts", {
    "@/lib/prisma": { prisma: { organizationMember: { findMany: async ({ where }) => {
      calls.queries.push(where);
      return eligible.filter((r) => (!where.organizationId || r.organizationId === where.organizationId) && (!where.userId || r.userId === where.userId)).map((r) => ({
        id: r.memberId, user: { id: r.userId, email: r.userEmail, fullName: "Name", preferences: {} }, organization: { id: r.organizationId, name: r.organizationName },
      }));
    } } } },
    "@/lib/ai": {}, "@/lib/ai/context/user-context": {},
  });
  const digestData = {
    userName: "Alex", organizationName: "Team", periodStart: period.start, periodEnd: period.end,
    shoutoutsReceived: [{ giverName: "Pat", message: "<script>probe()</script>" }], shoutoutsGiven: 1,
    pointsEarned: 1, totalPoints: 1, currentStreak: 1, badgesEarned: [], activeChallenges: [],
    topContributors: [], suggestedActions: [], appUrl: "https://app.example.test",
  };
  const route = loadModule("src/app/api/email/digest/route.ts", {
    "@/lib/auth/request-protection": {
      consumeAuthLimits: async limits => { calls.limits.push(limits); if (denyTest) throw new Error("test-limit"); },
      authProtectionResponse: error => error.message === "test-limit" ? new Response("{}", { status: 429 }) : null,
    },
    "next-auth": { getServerSession: async () => session },
    "@/lib/auth/config": { authOptions: {} },
    "@/lib/prisma": { prisma: { emailDigestLog: { findFirst: async () => sentAlready ? { id: "legacy" } : null, create: async () => ({ id: "log" }), update: async () => ({}) } } },
    "@/lib/email/resend": { isEmailConfigured: () => true, sendEmail: async (options) => { calls.sends.push(options); return { success: true }; } },
    "@/lib/email/digest-service": {
      getDigestRecipients: service.getDigestRecipients,
      getWeeklyDigestPeriod: () => period,
      wasDigestSent: async () => sentAlready,
      generateDigestNarrative: async () => "<script>narrative()</script>",
      getUserDigestData: async (...args) => { calls.data.push(args); return digestData; },
    },
  });
  return { route, calls };
}

async function withSecret(value, work) {
  const previous = process.env.CRON_SECRET;
  try {
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    await work();
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
}

function request(query = "", headers = {}) {
  return new Request(`https://app.example.test/api/email/digest${query}`, { method: "POST", headers });
}

test("missing, empty, and whitespace cron configuration cannot authenticate dispatch", async () => {
  for (const secret of [undefined, "", "   "]) {
    await withSecret(secret, async () => {
      for (const headers of [{}, { authorization: "Bearer undefined" }, { "x-cron-secret": "" }]) {
        const { route, calls } = setup();
        assert.equal((await route.POST(request("", headers))).status, 401);
        assert.equal(calls.queries.length, 0);
        assert.equal(calls.sends.length, 0);
      }
    });
  }
});

test("query-string secret does not authorize dispatch", async () => {
  await withSecret("test-scheduler-secret", async () => {
    const { route, calls } = setup();
    assert.equal((await route.POST(request("?secret=test-scheduler-secret"))).status, 401);
    assert.equal(calls.queries.length, 0);
  });
});

test("tenant admin dispatch loads and sends only current organization recipients", async () => {
  await withSecret(undefined, async () => {
    const { route, calls } = setup({ session: admin });
    const result = await route.POST(request());
    assert.equal(result.status, 200);
    assert.equal(calls.queries[0].organizationId, "org-a");
    assert.equal(calls.queries[0].status, "ACTIVE");
    assert.equal(calls.queries[0].user.emailVerified, true);
    assert.deepEqual(calls.sends.map((s) => s.to), ["a@example.test"]);
    assert.deepEqual(calls.data.map((args) => args[2]), ["org-a"]);
  });
});

test("target user cannot expand a tenant administrator's recipient scope", async () => {
  const { route, calls } = setup({ session: admin });
  const result = await route.POST(request("?userId=user-b"));
  assert.equal(result.status, 200);
  assert.equal(calls.queries[0].organizationId, "org-a");
  assert.equal(calls.queries[0].userId, "user-b");
  assert.equal(calls.sends.length, 0);
});

test("valid scheduler headers retain global dispatch and duplicate protection", async () => {
  await withSecret("test-scheduler-secret", async () => {
    for (const headers of [{ authorization: "Bearer test-scheduler-secret" }, { "x-cron-secret": "test-scheduler-secret" }]) {
      const { route, calls } = setup();
      assert.equal((await route.POST(request("", headers))).status, 200);
      assert.equal(calls.queries[0].organizationId, undefined);
      assert.equal(calls.sends.length, 3);
      const prior = setup({ sentAlready: true });
      assert.equal((await prior.route.POST(request("", headers))).status, 200);
      assert.equal(prior.calls.sends.length, 0);
    }
  });
});

test("cron test mode requires a session and never falls back to all recipients", async () => {
  await withSecret("test-scheduler-secret", async () => {
    const { route, calls } = setup();
    const result = await route.POST(request("?test=true", { authorization: "Bearer test-scheduler-secret" }));
    assert.equal(result.status, 401);
    assert.equal(calls.queries.length, 0);
    assert.equal(calls.sends.length, 0);
  });
});

test("test dispatch is exactly the authenticated user in their current organization", async () => {
  await withSecret("test-scheduler-secret", async () => {
    for (const headers of [{}, { authorization: "Bearer test-scheduler-secret" }]) {
      const { route, calls } = setup({ session: admin, sentAlready: true });
      assert.equal((await route.POST(request("?test=true&userId=user-b", headers))).status, 200);
      assert.equal(calls.queries[0].organizationId, "org-a");
      assert.equal(calls.queries[0].userId, "user-a");
      assert.deepEqual(calls.data.map((args) => [args[0], args[1], args[2]]), [["user-a", "member-a", "org-a"]]);
      assert.equal(calls.sends.length, 1);
    }
  });
});

test("member role and missing organization do not authorize tenant dispatch", async () => {
  for (const [session, expected] of [
    [{ user: { ...admin.user, role: "MEMBER" } }, 403],
    [{ user: { ...admin.user, organizationId: undefined } }, 400],
  ]) {
    const { route, calls } = setup({ session });
    assert.equal((await route.POST(request())).status, expected);
    assert.equal(calls.queries.length, 0);
  }
});

test("HTML preview escapes stored and AI text and uses sandboxed noncached response", async () => {
  const { route, calls } = setup({ session: admin });
  const result = await route.GET(new Request("https://app.example.test/api/email/digest?format=html"));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(result.headers.get("content-security-policy"), /^sandbox;/);
  assert.match(result.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  const body = await result.text();
  assert.doesNotMatch(body, /<script>/);
  assert.ok(body.includes("&lt;script&gt;probe()&lt;/script&gt;"));
  assert.ok(body.includes("&lt;script&gt;narrative()&lt;/script&gt;"));
  assert.equal(calls.sends.length, 0);
});


test("repeated manual test sends consume shared recipient/org/global limits before generating or sending", async () => {
  const { route, calls } = setup({ session: admin, denyTest: true });
  assert.equal((await route.POST(request("?test=true"))).status, 429);
  assert.equal(calls.queries.length, 0); assert.equal(calls.data.length, 0); assert.equal(calls.sends.length, 0);
  assert.deepEqual(calls.limits[0].map(bucket => [bucket.scope, bucket.identity, bucket.limit]), [
    ["digest-test:global", "global", 100], ["digest-test:organization", "org-a", 10], ["digest-test:recipient", "user-a", 3],
  ]);
});
