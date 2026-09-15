const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { loadModule } = require("./load-module.cjs");

// This test may write only synthetic records in the dedicated disposable database.
let database;
try { database = new URL(process.env.DATABASE_URL || ""); } catch {}
if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55487" || database.pathname !== "/strengthsync_security" || database.search) {
  throw new Error("AI admission integration tests require the disposable loopback database on port 55487 named strengthsync_security");
}

const prisma = new PrismaClient();
const prefix = `admission-test-${randomUUID()}`;
const limiter = loadModule("src/lib/ai/rate-limiter.ts", { "@/lib/prisma": { prisma } });
const tracker = loadModule("src/lib/ai/token-tracker.ts", {
  "@/lib/prisma": { prisma }, "./client": { calculateCost: () => 0 },
});
const options = (organizationId, memberId, reservedTokens = 100) => ({ organizationId, memberId: `${organizationId}:${memberId}`, reservedTokens, feature: "chat", endpoint: "/api/ai/chat", model: "test-model" });
const usage = (organizationId, memberId, reservationId, success = true) => ({
  organizationId, memberId: `${organizationId}:${memberId}`, reservationId, feature: "chat", endpoint: "/api/ai/chat", success, usageKnown: success,
  usage: { promptTokens: success ? 20 : 0, completionTokens: success ? 10 : 0, totalTokens: success ? 30 : 0, model: "test-model", latencyMs: 1 },
});

test.after(async () => {
  await prisma.aIUsageLog.deleteMany({ where: { organizationId: { startsWith: prefix } } });
  await prisma.$disconnect();
});

test("concurrent same-member admissions stop at ten before any provider completes", async () => {
  const organizationId = `${prefix}-member`;
  const results = await Promise.all(Array.from({ length: 20 }, () => limiter.reserveAIRequest(options(organizationId, "member"))));
  assert.equal(results.filter((r) => r.allowed).length, 10);
  const rows = await prisma.aIUsageLog.findMany({ where: { organizationId } });
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.totalTokens === 0 && r.reservedTokens === 100 && r.settledAt === null));
});

test("concurrent organization admissions across members stop at fifty", async () => {
  const organizationId = `${prefix}-org`;
  const results = await Promise.all(Array.from({ length: 60 }, (_, index) => limiter.reserveAIRequest(options(organizationId, `member-${index}`))));
  assert.equal(results.filter((r) => r.allowed).length, 50);
  assert.equal(await prisma.aIUsageLog.count({ where: { organizationId } }), 50);
});

test("parallel requests reserve member and organization token budgets", async () => {
  const memberOrg = `${prefix}-member-tokens`;
  const memberResults = await Promise.all([1, 2].map(() => limiter.reserveAIRequest(options(memberOrg, "member", 60000))));
  assert.equal(memberResults.filter((r) => r.allowed).length, 1);
  const organizationId = `${prefix}-org-tokens`;
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => limiter.reserveAIRequest(options(organizationId, `member-${index}`, 60000))));
  assert.equal(results.filter((r) => r.allowed).length, 16);
  const totals = await prisma.aIUsageLog.aggregate({ where: { organizationId }, _sum: { reservedTokens: true, totalTokens: true } });
  assert.equal(totals._sum.reservedTokens, 960000);
  assert.equal(totals._sum.totalTokens, 0);
});

test("legacy usage counts toward new reservation admission", async () => {
  const organizationId = `${prefix}-legacy`;
  await prisma.aIUsageLog.create({ data: {
    memberId: `${organizationId}:member`, organizationId, feature: "chat", endpoint: "/api/ai/chat", model: "test-model",
    promptTokens: 49000, completionTokens: 1000, totalTokens: 50000, latencyMs: 1,
  } });
  assert.equal((await limiter.reserveAIRequest(options(organizationId, "member", 60000))).allowed, false);
  assert.equal((await limiter.reserveAIRequest(options(organizationId, "member", 50000))).allowed, true);
});

test("settlement replaces allowance once without an extra request or token count", async () => {
  const organizationId = `${prefix}-settle`;
  const reservation = await limiter.reserveAIRequest(options(organizationId, "member", 1000));
  assert.ok(reservation.allowed);
  await Promise.all([1, 2, 3].map(() => tracker.logUsage(usage(organizationId, "member", reservation.reservationId))));
  const rows = await prisma.aIUsageLog.findMany({ where: { organizationId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reservedTokens, 0);
  assert.equal(rows[0].totalTokens, 30);
  assert.equal(rows[0].success, true);
  assert.ok(rows[0].settledAt);
  await assert.rejects(tracker.logUsage(usage(`${prefix}-other`, "member", reservation.reservationId)), /not found/);
});

test("failed or abandoned provider calls retain their allowance", async () => {
  const organizationId = `${prefix}-failed`;
  const reservation = await limiter.reserveAIRequest(options(organizationId, "member", 60000));
  assert.ok(reservation.allowed);
  await tracker.logUsage(usage(organizationId, "member", reservation.reservationId, false));
  await tracker.logUsage(usage(organizationId, "member", reservation.reservationId, false));
  const row = await prisma.aIUsageLog.findUnique({ where: { id: reservation.reservationId } });
  assert.equal(row.totalTokens, 0);
  assert.equal(row.reservedTokens, 60000);
  assert.equal(row.success, false);
  assert.equal((await limiter.reserveAIRequest(options(organizationId, "member", 60000))).allowed, false);
});


test("successful completion without complete usage retains its unaccounted allowance", async () => {
  const organizationId = `${prefix}-unknown-usage`;
  const reservation = await limiter.reserveAIRequest(options(organizationId, "member", 60000));
  assert.ok(reservation.allowed);
  const record = usage(organizationId, "member", reservation.reservationId);
  record.usageKnown = false;
  record.usage = { ...record.usage, promptTokens: 10, completionTokens: 0, totalTokens: 10 };
  await tracker.logUsage(record);
  const row = await prisma.aIUsageLog.findUnique({ where: { id: reservation.reservationId } });
  assert.equal(row.success, true);
  assert.equal(row.totalTokens + row.reservedTokens, 60000);
  assert.equal((await limiter.reserveAIRequest(options(organizationId, "member", 60000))).allowed, false);
});
