const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadModule } = require('./load-module.cjs');
let database;
try { database = new URL(process.env.DATABASE_URL || ''); } catch {}
if (!database || !['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost'].includes(database.hostname) || database.port !== '55487' || database.pathname !== '/strengthsync_security' || database.search) throw new Error('Challenge integration tests require disposable loopback PostgreSQL port55487 database strengthsync_security');
const prisma = new PrismaClient(), prefix = `bingo-test-${randomUUID()}`;
let organization, member, peer, domain, theme;
const users = [];
const makeBoard = () => Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ theme: theme.name, domain: 'executing', marked: false })));
const req = body => new Request('https://app.example.test/api/challenges/bingo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function fixture(board, rules = {}) {
  const challenge = await prisma.teamChallenge.create({ data: { organizationId: organization.id, name: 'Synthetic Bingo', description: 'Synthetic concurrency fixture', challengeType: 'STRENGTHS_BINGO', rules, status: 'ACTIVE', startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 600000) } });
  const participant = await prisma.challengeParticipant.create({ data: { challengeId: challenge.id, memberId: member.id, progress: { board, completedLines: [], hasWon: false } } });
  await prisma.organizationMember.update({ where: { id: member.id }, data: { points: 0 } });
  return { challenge, participant, context: { params: Promise.resolve({ challengeId: challenge.id }) } };
}
function route(role = 'MEMBER', prismaOverride = prisma) {
  return loadModule('src/app/api/challenges/[challengeId]/bingo/route.ts', {
    '@/lib/prisma': { prisma: prismaOverride }, '@/lib/auth/config': { authOptions: {} },
    'next-auth': { getServerSession: async () => ({ user: { id: member.userId, memberId: member.id, organizationId: organization.id, role } }) },
    '@/lib/gamification/badge-engine': { checkAndAwardBadges: async () => {} },
  });
}
test.before(async () => {
  organization = await prisma.organization.create({ data: { name: prefix, slug: prefix } });
  for (let i = 0; i < 2; i++) users.push(await prisma.user.create({ data: { email: `${prefix}-${i}@example.test`, fullName: `Synthetic ${i}`, emailVerificationRequired: false } }));
  member = await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: users[0].id } });
  peer = await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: users[1].id } });
  domain = await prisma.strengthDomain.create({ data: { name: prefix, slug: prefix, description: 'Synthetic', colorHex: '#000000', colorName: 'Synthetic', iconName: 'Synthetic' } });
  theme = await prisma.strengthTheme.create({ data: { name: prefix, slug: prefix, shortDescription: 'Synthetic', fullDescription: 'Synthetic', domainId: domain.id, blindSpots: [], actionItems: [], worksWith: [], keywords: [] } });
  await prisma.memberStrength.create({ data: { memberId: peer.id, themeId: theme.id, rank: 5, isTop5: true, isTop10: true, personalizedInsights: [] } });
});
test.after(async () => {
  if (organization) {
    await prisma.teamChallenge.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
  if (theme) await prisma.strengthTheme.delete({ where: { id: theme.id } });
  if (domain) await prisma.strengthDomain.delete({ where: { id: domain.id } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  await prisma.$disconnect();
});

test('thirty simultaneous winning square requests record one transition and award fifty points', async () => {
  const board = makeBoard(); for (let i = 0; i < 4; i++) board[0][i].marked = true;
  const { participant, context } = await fixture(board);
  const handler = route();
  const responses = await Promise.all(Array.from({ length: 30 }, () => handler.POST(req({ row: 0, col: 4, memberId: peer.id }), context)));
  assert.equal(responses.filter(response => response.status === 200).length, 1); assert.equal(responses.filter(response => response.status === 409).length, 29);
  assert.equal((await prisma.organizationMember.findUnique({ where: { id: member.id } })).points, 50);
  assert.ok((await prisma.challengeParticipant.findUnique({ where: { id: participant.id } })).completedAt);
});

test('distinct concurrent winning squares preserve both board updates while rewarding only once', async () => {
  const board = makeBoard(); for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) board[row][col].marked = true;
  const { participant, context } = await fixture(board);
  const handler = route(); const responses = await Promise.all([0, 1].map(row => handler.POST(req({ row, col: 4, memberId: peer.id }), context)));
  assert.ok(responses.every(response => response.status === 200));
  const stored = await prisma.challengeParticipant.findUnique({ where: { id: participant.id } });
  assert.equal(stored.progress.board[0][4].marked, true); assert.equal(stored.progress.board[1][4].marked, true);
  assert.ok(stored.progress.completedLines.includes('row-0')); assert.ok(stored.progress.completedLines.includes('row-1'));
  assert.equal((await prisma.organizationMember.findUnique({ where: { id: member.id } })).points, 50);
});

test('rank six is hidden from peer bingo checks while manager policy permits the same match', async () => {
  const { context, participant } = await fixture(makeBoard());
  await prisma.memberStrength.update({ where: { memberId_themeId: { memberId: peer.id, themeId: theme.id } }, data: { rank: 6, isTop5: false } });
  assert.equal((await route().POST(req({ row: 0, col: 0, memberId: peer.id }), context)).status, 400);
  assert.equal((await prisma.challengeParticipant.findUnique({ where: { id: participant.id } })).progress.board[0][0].marked, false);
  assert.equal((await route('MANAGER').POST(req({ row: 0, col: 0, memberId: peer.id }), context)).status, 200);
  await prisma.memberStrength.update({ where: { memberId_themeId: { memberId: peer.id, themeId: theme.id } }, data: { rank: 5, isTop5: true } });
});

test('point-write failure rolls back the board and completion transition together', async () => {
  const board = makeBoard(); for (let i = 0; i < 4; i++) board[0][i].marked = true;
  const { participant, context } = await fixture(board);
  const boundary = { teamChallenge: prisma.teamChallenge, $transaction: fn => prisma.$transaction(tx => fn({ ...tx, organizationMember: { findFirst: tx.organizationMember.findFirst.bind(tx.organizationMember), update: async () => { throw Error('synthetic points failure'); } } })) };
  assert.equal((await route('MEMBER', boundary).POST(req({ row: 0, col: 4, memberId: peer.id }), context)).status, 500);
  const stored = await prisma.challengeParticipant.findUnique({ where: { id: participant.id } });
  assert.equal(stored.completedAt, null); assert.equal(stored.progress.board[0][4].marked, false);
  assert.equal((await prisma.organizationMember.findUnique({ where: { id: member.id } })).points, 0);
});
