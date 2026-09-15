const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { loadModule } = require("./load-module.cjs");

let database;
try { database = new URL(process.env.DATABASE_URL || ""); } catch {}
if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55487" || database.pathname !== "/strengthsync_security" || database.search || database.hash) {
  throw new Error("Skill-response integration tests require the disposable loopback database on port 55487 named strengthsync_security");
}

const prisma = new PrismaClient();
const secondPrisma = new PrismaClient();
const prefix = `skill-response-test-${randomUUID()}`;
const userIds = [], organizationIds = [];
const jsonRequest = (method, body, responseId) => new Request(`https://app.example.test/api/respond${responseId ? `?responseId=${responseId}` : ""}`, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

async function fixture() {
  const organization = await prisma.organization.create({ data: { name: "Synthetic Skill Requests", slug: `${prefix}-${organizationIds.length}` } });
  organizationIds.push(organization.id);
  const members = [];
  for (const name of ["Creator", "Helper"]) {
    const user = await prisma.user.create({ data: { email: `${prefix}-${userIds.length}@example.test`, fullName: `Synthetic ${name}` } });
    userIds.push(user.id);
    members.push(await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, status: "ACTIVE" } }));
  }
  const [creator, helper] = members;
  const skillRequest = await prisma.skillRequest.create({ data: {
    organizationId: organization.id, creatorId: creator.id, title: "Synthetic Help Request", description: "Synthetic concurrency fixture", status: "OPEN",
  } });
  const context = { params: Promise.resolve({ requestId: skillRequest.id }) };
  const rewardFailures = [];
  function route(member, client = prisma, failReward = false) {
    const boundary = failReward ? {
      skillRequest: client.skillRequest,
      skillRequestResponse: client.skillRequestResponse,
      notification: client.notification,
      $transaction: callback => client.$transaction(tx => callback({
        ...tx,
        organizationMember: {
          ...tx.organizationMember,
          // A real failed database write must roll back the preceding response/status writes.
          update: async args => {
            try {
              return await tx.organizationMember.update({ ...args, where: { id: `${prefix}-missing-member` } });
            } catch (error) {
              rewardFailures.push(error.code);
              throw error;
            }
          },
        },
      })),
    } : client;
    return loadModule("src/app/api/skill-requests/[requestId]/respond/route.ts", {
      "@/lib/prisma": { prisma: boundary },
      "@/lib/auth/config": { authOptions: {} },
      "next-auth": { getServerSession: async () => ({ user: { id: member.userId, memberId: member.id, organizationId: organization.id, role: "MEMBER" } }) },
      "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => [] },
      "@/lib/integrations/teams-webhook": { sendTeamsNotification: async () => {}, buildSkillRequestCard: () => ({}) },
    });
  }
  return {
    creator, helper, skillRequest, rewardFailures,
    offer: (client = prisma, failReward = false) => route(helper, client, failReward).POST(jsonRequest("POST", { message: "Happy to help with this request" }), context),
    accept: (responseId, client = prisma, failReward = false) => route(creator, client, failReward).PATCH(jsonRequest("PATCH", { status: "ACCEPTED" }, responseId), context),
    seedResponse: status => prisma.skillRequestResponse.create({ data: { requestId: skillRequest.id, responderId: helper.id, message: "Synthetic historical response", status } }),
    points: async () => (await prisma.organizationMember.findUniqueOrThrow({ where: { id: helper.id } })).points,
    status: async () => (await prisma.skillRequest.findUniqueOrThrow({ where: { id: skillRequest.id } })).status,
    notifications: () => prisma.notification.count({ where: { userId: { in: [creator.userId, helper.userId] } } }),
  };
}

test.after(async () => {
  try {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.skillRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await Promise.all([prisma.$disconnect(), secondPrisma.$disconnect()]);
  }
});

test("twelve PostgreSQL offers through independent clients create one response and award fifteen points once", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => f.offer(index % 2 ? secondPrisma : prisma)));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 11);
  assert.equal(await prisma.skillRequestResponse.count({ where: { requestId: f.skillRequest.id, responderId: f.helper.id } }), 1);
  assert.equal(await f.points(), 15);
  assert.equal(await f.status(), "IN_PROGRESS");
  assert.equal(await f.notifications(), 1);
});

test("twelve PostgreSQL acceptances through independent clients award twenty-five extra points once", async () => {
  const f = await fixture();
  const offer = await f.offer();
  assert.equal(offer.status, 201);
  const { data: response } = await offer.json();
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => f.accept(response.id, index % 2 ? secondPrisma : prisma)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 11);
  assert.equal(await f.points(), 40);
  assert.equal(await f.status(), "FULFILLED");
  assert.equal((await prisma.skillRequestResponse.findUniqueOrThrow({ where: { id: response.id } })).status, "ACCEPTED");
  assert.equal(await prisma.notification.count({ where: { userId: f.helper.userId, type: "SKILL_REQUEST_RESPONSE" } }), 1);
});

test("concurrent acceptance of historical duplicate rows has one winning pair in PostgreSQL", async () => {
  const f = await fixture();
  const first = await f.seedResponse("OFFERED"), second = await f.seedResponse("OFFERED");
  const results = await Promise.all([f.accept(first.id), f.accept(second.id, secondPrisma)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const rows = await prisma.skillRequestResponse.findMany({ where: { requestId: f.skillRequest.id } });
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => row.status === "ACCEPTED").length, 1);
  const remaining = rows.find(row => row.status === "OFFERED");
  assert.equal((await f.accept(remaining.id, secondPrisma)).status, 409);
  assert.equal(await f.points(), 25);
  assert.equal(await f.notifications(), 1);
});

for (const status of ["ACCEPTED", "COMPLETED"]) {
  test(`a historical ${status} sibling prevents another acceptance and reward in PostgreSQL`, async () => {
    const f = await fixture();
    await f.seedResponse(status);
    const duplicate = await f.seedResponse("OFFERED");
    await prisma.organizationMember.update({ where: { id: f.helper.id }, data: { points: 25 } });
    assert.equal((await f.accept(duplicate.id)).status, 409);
    assert.equal((await prisma.skillRequestResponse.findUniqueOrThrow({ where: { id: duplicate.id } })).status, "OFFERED");
    assert.equal(await f.points(), 25);
    assert.equal(await f.notifications(), 0);
  });
}

test("a failed PostgreSQL offer reward rolls back response creation and request status", async () => {
  const f = await fixture();
  assert.equal((await f.offer(prisma, true)).status, 500);
  assert.deepEqual(f.rewardFailures, ["P2025"]);
  assert.equal(await prisma.skillRequestResponse.count({ where: { requestId: f.skillRequest.id } }), 0);
  assert.equal(await f.points(), 0);
  assert.equal(await f.status(), "OPEN");
  assert.equal(await f.notifications(), 0);
  assert.equal((await f.offer(secondPrisma)).status, 201);
  assert.equal(await f.points(), 15);
});

test("a failed PostgreSQL acceptance reward rolls back both accepted and fulfilled statuses", async () => {
  const f = await fixture();
  const offer = await f.offer();
  assert.equal(offer.status, 201);
  const { data: response } = await offer.json();
  assert.equal((await f.accept(response.id, prisma, true)).status, 500);
  assert.deepEqual(f.rewardFailures, ["P2025"]);
  assert.equal((await prisma.skillRequestResponse.findUniqueOrThrow({ where: { id: response.id } })).status, "OFFERED");
  assert.equal(await f.points(), 15);
  assert.equal(await f.status(), "IN_PROGRESS");
  assert.equal(await f.notifications(), 1);
  assert.equal((await f.accept(response.id, secondPrisma)).status, 200);
  assert.equal(await f.points(), 40);
  assert.equal(await f.notifications(), 2);
});
