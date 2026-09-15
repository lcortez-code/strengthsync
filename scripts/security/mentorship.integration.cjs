const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { loadModule } = require("./load-module.cjs");

let database;
try { database = new URL(process.env.DATABASE_URL || ""); } catch {}
if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55487" || database.pathname !== "/strengthsync_security" || database.search) {
  throw new Error("Mentorship integration tests require the disposable loopback database on port 55487 named strengthsync_security");
}
const prisma = new PrismaClient();
const prefix = `mentorship-test-${randomUUID()}`;
const users = [], organizations = [], relationships = [];

async function fixture(failReward = false) {
  const org = await prisma.organization.create({ data: { name: "Synthetic Organization", slug: `${prefix}-${organizations.length}` } });
  organizations.push(org.id);
  const members = [];
  for (const name of ["Mentor", "Mentee"]) {
    const user = await prisma.user.create({ data: { email: `${prefix}-${users.length}@example.test`, fullName: name } });
    users.push(user.id);
    members.push(await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, status: "ACTIVE" } }));
  }
  const [mentor, mentee] = members;
  const relation = await prisma.mentorship.create({ data: { mentorId: mentor.id, menteeId: mentee.id, status: "PENDING", focusAreas: ["Synthetic development"] } });
  relationships.push(relation.id);
  const databaseBoundary = failReward ? {
    mentorship: prisma.mentorship,
    $transaction: (fn) => prisma.$transaction((tx) => fn({ ...tx, organizationMember: { ...tx.organizationMember, updateMany: async () => { throw new Error("Synthetic reward failure"); } } })),
  } : prisma;
  const route = loadModule("src/app/api/mentorship/[mentorshipId]/route.ts", {
    "@/lib/prisma": { prisma: databaseBoundary },
    "next-auth": { getServerSession: async () => ({ user: { id: mentor.userId, memberId: mentor.id, organizationId: org.id, role: "MEMBER" } }) },
    "@/lib/auth/config": { authOptions: {} },
    "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => {} },
  });
  const accept = () => route.PATCH(new Request("https://app.example.test/api/mentorship/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept" }) }), { params: Promise.resolve({ mentorshipId: relation.id }) });
  return { mentor, mentee, relation, accept };
}

test.after(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mentorship.deleteMany({ where: { id: { in: relationships } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("twelve real PostgreSQL mentorship accepts award twenty points and one notification", async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, () => f.accept()));
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.ok(responses.every((response) => [200, 400, 409].includes(response.status)));
  const mentor = await prisma.organizationMember.findUnique({ where: { id: f.mentor.id } });
  const relation = await prisma.mentorship.findUnique({ where: { id: f.relation.id } });
  assert.equal(mentor.points, 20);
  assert.equal(relation.status, "ACTIVE");
  assert.equal(await prisma.notification.count({ where: { userId: f.mentee.userId, type: "MENTORSHIP_ACCEPTED" } }), 1);
});

test("a failed reward rolls back status and notification in the real database", async () => {
  const f = await fixture(true);
  assert.equal((await f.accept()).status, 500);
  assert.equal((await prisma.mentorship.findUnique({ where: { id: f.relation.id } })).status, "PENDING");
  assert.equal((await prisma.organizationMember.findUnique({ where: { id: f.mentor.id } })).points, 0);
  assert.equal(await prisma.notification.count({ where: { userId: f.mentee.userId } }), 0);
});
