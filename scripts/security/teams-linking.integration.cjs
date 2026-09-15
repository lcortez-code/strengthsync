const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { loadModule } = require("./load-module.cjs");

let database;
try { database = new URL(process.env.DATABASE_URL || ""); } catch {}
if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55487" || database.pathname !== "/strengthsync_security" || database.search) {
  throw new Error("Teams integration tests require the disposable loopback database on port 55487 named strengthsync_security");
}
const prisma = new PrismaClient();
const prefix = `teams-test-${randomUUID()}`;
const tenantId = randomUUID();
const identities = [];
const createdUsers = [];
const createdOrganizations = [];
Object.assign(process.env, { MICROSOFT_APP_TENANT_ID: tenantId, MICROSOFT_APP_ID: "synthetic-app", MICROSOFT_APP_PASSWORD: "synthetic-only", NEXTAUTH_URL: "https://strengthsync.test" });
const helpers = loadModule("src/lib/integrations/teams-linking.ts", { "@/lib/prisma": { prisma } });

async function setup() {
  const user = await prisma.user.create({ data: { email: `${prefix}-${createdUsers.length}@example.test`, fullName: "Synthetic Teams User" } });
  createdUsers.push(user.id);
  const organizations = [];
  for (const suffix of ["a", "b"]) {
    const org = await prisma.organization.create({ data: { name: "Synthetic Organization", slug: `${prefix}-${createdOrganizations.length}-${suffix}` } });
    createdOrganizations.push(org.id); organizations.push(org);
    await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, status: "ACTIVE" } });
  }
  const identity = { tenantId, teamsUserId: randomUUID(), conversationId: `${prefix}-personal-chat`, displayName: "Synthetic Teams User" };
  identities.push(identity.teamsUserId);
  const issue = async () => new URLSearchParams(new URL(await helpers.createTeamsLinkChallenge(identity)).hash.slice(1)).get("token");
  return { user, organizations, identity, issue };
}

test.after(async () => {
  await prisma.teamsUserMapping.deleteMany({ where: { teamsUserId: { in: identities } } });
  await prisma.teamsLinkChallenge.deleteMany({ where: { teamsUserId: { in: identities }, teamsTenantId: tenantId } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrganizations } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

test("PostgreSQL serializes simultaneous challenge consumption to one explicit organization", async () => {
  const f = await setup(); const token = await f.issue();
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => helpers.acceptTeamsLink(token, f.user.id, f.organizations[i % 2].id)));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const mapping = await prisma.teamsUserMapping.findUnique({ where: { teamsUserId: f.identity.teamsUserId } });
  assert.ok(mapping.verifiedAt);
  assert.equal(mapping.teamsTenantId, tenantId);
  assert.equal(mapping.organizationId, outcomes.find((outcome) => outcome.status === "fulfilled").value.organizationId);
  await assert.rejects(helpers.acceptTeamsLink(token, f.user.id, f.organizations[0].id), /invalid or expired|already been used/);
});

test("PostgreSQL enforces conflict protection without consuming the legitimate challenge", async () => {
  const owner = await setup(); const other = await setup();
  await helpers.acceptTeamsLink(await owner.issue(), owner.user.id, owner.organizations[0].id);
  const token = await owner.issue();
  await assert.rejects(helpers.acceptTeamsLink(token, other.user.id, other.organizations[0].id), /another account/);
  await helpers.acceptTeamsLink(token, owner.user.id, owner.organizations[1].id);
  const mapping = await prisma.teamsUserMapping.findUnique({ where: { teamsUserId: owner.identity.teamsUserId } });
  assert.equal(mapping.userId, owner.user.id);
  assert.equal(mapping.organizationId, owner.organizations[1].id);
});

test("real bot resolver never falls back to another active membership after revocation", async () => {
  const f = await setup();
  await helpers.acceptTeamsLink(await f.issue(), f.user.id, f.organizations[1].id);
  const commands = loadModule("src/lib/integrations/teams-bot-handlers.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/gamification/badge-engine": { checkAndAwardBadges: async () => {} },
  });
  const normal = await commands.handleTeamsBotCommand(f.identity, "/requests");
  assert.match(normal.body[0].text, /No open skill requests/);
  await prisma.organizationMember.updateMany({ where: { userId: f.user.id, organizationId: f.organizations[1].id }, data: { status: "INACTIVE" } });
  const revoked = await commands.handleTeamsBotCommand(f.identity, "/requests");
  assert.equal(revoked.actions[0].title, "Link Account");
  assert.equal((await helpers.getTeamsLinkStatus(f.user.id)).links[0].active, false);
  assert.equal(await prisma.organizationMember.count({ where: { userId: f.user.id, status: "ACTIVE" } }), 1);
});

test("expiry and unlink invalidate real database challenges", async () => {
  const f = await setup(); const expired = await f.issue();
  await prisma.teamsLinkChallenge.updateMany({ where: { teamsUserId: f.identity.teamsUserId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(helpers.acceptTeamsLink(expired, f.user.id, f.organizations[0].id), /invalid or expired/);
  const linked = await helpers.acceptTeamsLink(await f.issue(), f.user.id, f.organizations[0].id);
  const outstanding = await f.issue();
  await helpers.unlinkTeamsAccount(linked.id, f.user.id);
  assert.equal(await prisma.teamsUserMapping.count({ where: { teamsUserId: f.identity.teamsUserId } }), 0);
  await assert.rejects(helpers.acceptTeamsLink(outstanding, f.user.id, f.organizations[0].id), /invalid or expired/);
});
