const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./load-module.cjs");

const date = new Date("2026-01-01T00:00:00Z");
const strength = rank => ({ id: `s${rank}`, rank, personalizedDescription: "Private description", theme: { slug: `theme-${rank}`, name: `Theme ${rank}`, shortDescription: "Public description", domain: { slug: "strategic", name: "Strategic", colorHex: "#008800" } } });
function member(id = "target", ranks = [1, 6, 7]) {
  return { id, organizationId: "org", status: "ACTIVE", points: 120, streak: 3, joinedAt: date,
    user: { fullName: "Target", email: "target@example.test", bio: "Private bio" },
    strengths: ranks.map(strength), badgesEarned: [{ earnedAt: date, badge: { name: "Badge", iconUrl: "star", tier: "GOLD" } }],
    _count: { shoutoutsReceived: 2, shoutoutsGiven: 3, mentorshipsAsMentor: 1, mentorshipsAsMentee: 2 },
  };
}
function load(path, prisma, role = "MEMBER", memberId = "viewer") {
  return loadModule(`src/app/api/${path}/route.ts`, {
    "next-auth": { getServerSession: async () => ({ user: { id: "u", memberId, role, organizationId: "org" } }) },
    "@/lib/auth/config": { authOptions: {} }, "@/lib/prisma": { prisma },
  });
}
const request = () => new Request("http://localhost/api/card");
const params = { params: Promise.resolve({ memberId: "target" }) };

for (const [role, self, full] of [["MEMBER", false, false], ["MEMBER", true, true], ["MANAGER", false, true]]) {
  test(`card response applies ${role}/${self ? "self" : "peer"} visibility including sparse ranks`, async () => {
    const record = member("target", [6, 7]);
    const prisma = { organizationMember: { findFirst: async (q) => {
      assert.deepEqual(q.where, { id: "target", organizationId: "org", status: "ACTIVE" });
      assert.deepEqual(q.include.strengths.where, full ? undefined : { rank: { lte: 5 } });
      assert.equal(q.include.user.select.bio, full);
      assert.equal(q.include.shoutoutsReceived, undefined);
      return { ...record, strengths: record.strengths.filter(s => !q.include.strengths.where || s.rank <= q.include.strengths.where.rank.lte) };
    } } };
    const response = await load("cards/[memberId]", prisma, role, self ? "target" : "viewer").GET(request(), params);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.isFullProfile, full);
    assert.deepEqual(data.allStrengths.map(s => s.rank), full ? [6, 7] : []);
    assert.deepEqual(data.topStrengths, []);
    assert.deepEqual(data.domainDistribution, full ? { strategic: 2 } : {});
    assert.equal(data.bio, full ? "Private bio" : null);
    assert.equal(data.stats?.points ?? null, full ? 120 : null);
    assert.equal(data.badges.length, full ? 1 : 0);
    assert.equal(data.joinedAt, full ? date.toISOString() : null);
  });
}

test("card retains only actual top-five ranks for a basic peer", async () => {
  const record = member();
  const prisma = { organizationMember: { findFirst: async q => ({ ...record, strengths: record.strengths.filter(s => s.rank <= q.include.strengths.where.rank.lte) }) } };
  const response = await load("cards/[memberId]", prisma).GET(request(), params);
  const { data } = await response.json();
  assert.deepEqual(data.topStrengths.map(s => s.rank), [1]);
  assert.deepEqual(data.allStrengths.map(s => s.rank), [1]);
  assert.deepEqual(data.domainDistribution, { strategic: 1 });
});

for (const inaccessible of [{ organizationId: "other", status: "ACTIVE" }, { organizationId: "org", status: "PENDING" }, { organizationId: "org", status: "SUSPENDED" }]) {
  for (const path of ["cards/[memberId]", "members/[memberId]"]) {
    test(`${path} hides ${inaccessible.organizationId}/${inaccessible.status} targets`, async () => {
      const prisma = { organizationMember: { findFirst: async ({ where }) => where.organizationId === inaccessible.organizationId && where.status === inaccessible.status ? member() : null } };
      assert.equal((await load(path, prisma, "MANAGER").GET(request(), params)).status, 404);
    });
  }
}

for (const [role, viewer, full] of [["MEMBER", "viewer", false], ["MEMBER", "target", true], ["MANAGER", "viewer", true]]) {
  test(`profile ${role}/${viewer} exposes private shoutouts only to participants`, async () => {
    const records = [
      { id: "public", organizationId: "org", isPublic: true, giverId: "peer", receiverId: "target" },
      { id: "private-other", organizationId: "org", isPublic: false, giverId: "peer", receiverId: "target" },
      { id: "private-viewer", organizationId: "org", isPublic: false, giverId: "viewer", receiverId: "target" },
      { id: "foreign", organizationId: "other", isPublic: true, giverId: "peer", receiverId: "target" },
    ];
    let shoutoutReads = 0;
    const prisma = {
      organizationMember: { findFirst: async q => ({ ...member(), strengths: member().strengths.filter(s => !q.include.strengths.where || s.rank <= q.include.strengths.where.rank.lte) }) },
      shoutout: { findMany: async ({ where }) => {
        shoutoutReads++;
        assert.equal(where.organizationId, "org");
        return records.filter(r => r.organizationId === where.organizationId && r.receiverId === where.receiverId && where.OR.some(branch => Object.entries(branch).every(([key, value]) => r[key] === value)))
          .map(r => ({ ...r, message: r.id, createdAt: date, giver: { user: { fullName: "Giver" } }, theme: null }));
      } },
      badgeEarned: { findMany: async () => [] },
    };
    const response = await load("members/[memberId]", prisma, role, viewer).GET(request(), params);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(shoutoutReads, full ? 1 : 0);
    assert.deepEqual(data.shoutoutsReceived.map(s => s.id), !full ? [] : viewer === "target" ? ["public", "private-other", "private-viewer"] : ["public", "private-viewer"]);
    assert.equal(data.points, full ? 120 : undefined);
  });
}

function matches(record, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(branch => matches(record, branch));
    if (key === "AND") return value.every(branch => matches(record, branch));
    if (key === "strengths") return record.strengths.some(s => s.rank <= value.some.rank.lte && (!value.some.theme.slug || s.theme.slug === value.some.theme.slug));
    return record[key] === value;
  });
}
for (const role of ["MEMBER", "MANAGER"]) {
  test(`directory ${role} filters hidden ranks and projects points with profile policy`, async () => {
    const records = [member("viewer", [6]), member("target", [6]), member("top-five", [1])];
    const prisma = { organizationMember: {
      count: async ({ where }) => records.filter(r => matches(r, where)).length,
      findMany: async ({ where }) => records.filter(r => matches(r, where)).map(r => ({ ...r, strengths: r.strengths.filter(s => s.rank <= 5) })),
    } };
    const route = load("members", prisma, role);
    const filtered = await (await route.GET(new Request("http://localhost/api/members?theme=theme-6"))).json();
    assert.deepEqual(filtered.data.map(m => m.id), role === "MANAGER" ? ["viewer", "target"] : ["viewer"]);
    const all = await (await route.GET(new Request("http://localhost/api/members"))).json();
    assert.equal(all.data.find(m => m.id === "viewer").points, 120);
    assert.equal(all.data.find(m => m.id === "target").points, role === "MANAGER" ? 120 : undefined);
  });
}

function analyticsMember(id, themeSlug, rank) {
  const domain = themeSlug === "achiever" ? "executing" : "strategic";
  return { ...member(id, []), strengths: themeSlug ? [{ rank, theme: { slug: themeSlug, name: themeSlug, domain: { slug: domain } } }] : [] };
}
for (const role of ["MEMBER", "MANAGER"]) {
  for (const path of ["composition", "gaps"]) {
    test(`team ${path} preserves totals while ${role} sees only authorized individual ranks`, async () => {
      const records = [analyticsMember("target", "achiever", 6), analyticsMember("viewer", "strategic", 7), analyticsMember("public-peer", "learner", 5), ...Array.from({ length: 9 }, (_, i) => analyticsMember(`empty-${i}`))];
      const prisma = { organizationMember: { findMany: async ({ where }) => {
        assert.deepEqual(where, { organizationId: "org", status: "ACTIVE" }); return records;
      } } };
      const response = await load(`team/${path}`, prisma, role).GET(request());
      assert.equal(response.status, 200);
      const { data } = await response.json();
      const themes = path === "composition" ? data.themeFrequency : data.underrepresentedThemes;
      const peer = themes.find(t => t.slug === "achiever"), self = themes.find(t => t.slug === "strategic");
      assert.equal(peer.count, 1); assert.equal(peer.percentage, 8);
      assert.deepEqual(peer.members.map(m => [m.id, m.rank]), role === "MANAGER" ? [["target", 6]] : []);
      assert.deepEqual(self.members.map(m => [m.id, m.rank]), [["viewer", 7]]);
      assert.deepEqual(themes.find(t => t.slug === "learner").members.map(m => [m.id, m.rank]), [["public-peer", 5]]);
      if (path === "composition") assert.deepEqual(data.topThemes.find(t => t.slug === "achiever").members, peer.members);
    });
  }
  test(`partnership response respects ${role} access to sparse peer strengths`, async () => {
    const records = [analyticsMember("target", "achiever", 6), analyticsMember("viewer", "strategic", 1)];
    const prisma = { organizationMember: { findMany: async () => records } };
    const response = await load("team/partnerships", prisma, role).GET(request());
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.totalPossiblePairings, 1);
    assert.equal(data.partnerships.length, role === "MANAGER" ? 1 : 0);
    if (role === "MANAGER") assert.equal(data.partnerships[0].member1.topTheme, "achiever");
  });
}
test("partnerships preserve ordinary members' own deeper strengths", async () => {
  const records = [analyticsMember("target", "achiever", 1), analyticsMember("viewer", "strategic", 6)];
  const response = await load("team/partnerships", { organizationMember: { findMany: async () => records } }).GET(request());
  const { data } = await response.json();
  assert.equal(data.partnerships.length, 1);
  assert.equal(data.partnerships[0].member2.topTheme, "strategic");
});
