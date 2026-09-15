const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { loadModule } = require("./load-module.cjs");

let database;
try { database = new URL(process.env.DATABASE_URL || ""); } catch {}
if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55487" || database.pathname !== "/strengthsync_security" || database.search) {
  throw new Error("Chat service integration tests require the disposable loopback database on port 55487 named strengthsync_security");
}
const prisma = new PrismaClient();
const prefix = `chat-service-test-${randomUUID()}`;
const users = [], organizations = [];
const { ChatService } = loadModule("src/lib/ai/service.ts", {
  "@/lib/prisma": { prisma }, ai: {}, "./client": {}, "./prompts": {}, "./rate-limiter": {}, "./token-tracker": {},
});

async function fixture() {
  const org = await prisma.organization.create({ data: { name: "Synthetic Chat Organization", slug: `${prefix}-${organizations.length}` } });
  organizations.push(org.id);
  const user = await prisma.user.create({ data: { email: `${prefix}-${users.length}@example.test`, fullName: "Synthetic Chat Owner" } });
  users.push(user.id);
  const member = await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, status: "ACTIVE" } });
  return { org, member, chat: new ChatService(member.id, org.id) };
}

test.after(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("real database creates one owned conversation, persists history, then denies revoked membership", async () => {
  const { chat, member } = await fixture();
  const ids = await Promise.all(Array.from({ length: 12 }, () => chat.getOrCreateConversation("Synthetic topic")));
  assert.equal(new Set(ids).size, 1);
  assert.equal(await prisma.aIConversation.count({ where: { memberId: member.id } }), 1);
  await chat.saveMessage("USER", "Synthetic question");
  await chat.saveAssistantResponse("Synthetic reply");
  assert.deepEqual(await chat.getMessages(), [{ role: "user", content: "Synthetic question" }, { role: "assistant", content: "Synthetic reply" }]);
  await prisma.organizationMember.update({ where: { id: member.id }, data: { status: "INACTIVE" } });
  await assert.rejects(chat.getMessages(), /unavailable/);
  await assert.rejects(chat.saveAssistantResponse("Late reply"), /unavailable/);
  assert.equal(await prisma.aIMessage.count({ where: { conversationId: ids[0] } }), 2);
});

test("real database rejects foreign conversation and archived writes", async () => {
  const owner = await fixture(), other = await fixture();
  const id = await owner.chat.getOrCreateConversation();
  const foreign = new ChatService(other.member.id, other.org.id, id);
  await assert.rejects(foreign.getMessages(), /unavailable/);
  await assert.rejects(foreign.saveMessage("USER", "Foreign append"), /unavailable/);
  await prisma.aIConversation.update({ where: { id }, data: { status: "ARCHIVED" } });
  await assert.rejects(owner.chat.saveAssistantResponse("Archived reply"), /unavailable/);
  assert.equal(await prisma.aIMessage.count({ where: { conversationId: id } }), 0);
});
