const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./load-module.cjs');
const session = role => ({ user: { id: 'u', memberId: 'me', organizationId: 'org', role } });
const req = body => new Request('https://app.example.test/api/challenges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ challengeId: 'challenge' }) };
const base = (prisma, role = 'MEMBER') => ({ '@/lib/prisma': { prisma }, '@/lib/auth/config': { authOptions: {} }, 'next-auth': { getServerSession: async () => session(role) }, '@/lib/gamification/badge-engine': { checkAndAwardBadges: async () => {} } });
const board = () => Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ theme: 'Achiever', domain: 'executing', marked: false })));
const challenge = rules => ({ id: 'challenge', challengeType: 'STRENGTHS_BINGO', status: 'ACTIVE', rules });

test('challenge creation rejects unsupported grid sizes and rules before persistence', async () => {
  let writes = 0;
  const route = loadModule('src/app/api/challenges/route.ts', base({ teamChallenge: { create: async () => { writes++; } } }, 'OWNER'));
  for (const gridSize of [1e9, 4, 5.5, -1, '5', null, {}, []]) {
    const response = await route.POST(req({ name: 'Synthetic bingo', description: 'Synthetic challenge description', challengeType: 'STRENGTHS_BINGO', startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', rules: { gridSize } }));
    assert.equal(response.status, 422, `gridSize ${JSON.stringify(gridSize)}`);
  }
  assert.equal(writes, 0);
});

test('joining validates malicious stored rules before running board generation', async () => {
  let created = 0;
  const prisma = { teamChallenge: { findFirst: async () => challenge({ gridSize: 1e9 }) }, challengeParticipant: { findUnique: async () => null, create: async () => { created++; } } };
  const route = loadModule('src/app/api/challenges/[challengeId]/join/route.ts', base(prisma));
  assert.equal((await route.POST(req({}), context)).status, 422); assert.equal(created, 0);
  prisma.teamChallenge.findFirst = async () => challenge({});
  prisma.challengeParticipant.create = async args => { created++; return args.data; };
  const response = await route.POST(req({}), context); assert.equal(response.status, 200);
  const progress = (await response.json()).data.progress;
  assert.equal(progress.board.length, 5); assert.ok(progress.board.every(row => row.length === 5)); assert.equal(progress.board[2][2].theme, 'FREE');
});

function bingo(role = 'MEMBER', providedBoard = board(), options = {}) {
  const state = { queries: [], updates: [], awards: 0, locked: false, badges: 0, participant: { id: 'p', progress: { board: providedBoard, completedLines: [], hasWon: false }, completedAt: null } };
  const tx = {
    $queryRaw: async () => { state.locked = true; },
    challengeParticipant: {
      findUnique: async () => { assert.equal(state.locked, true); return state.participant; },
      update: async args => { state.updates.push(args); state.participant.progress = args.data.progress; },
      updateMany: async args => { assert.equal(args.where.completedAt, null); if (state.participant.completedAt) return { count: 0 }; state.participant.completedAt = args.data.completedAt; return { count: 1 }; },
    },
    organizationMember: {
      findFirst: async args => { state.queries.push(args); return options.targetMissing ? null : { user: { fullName: 'Teammate' } }; },
      update: async args => { assert.equal(args.where.id, 'me'); state.awards += args.data.points.increment; },
    },
  };
  const prisma = { teamChallenge: { findFirst: async () => challenge(options.rules || {}) }, $transaction: async fn => fn(tx) };
  const route = loadModule('src/app/api/challenges/[challengeId]/bingo/route.ts', { ...base(prisma, role), '@/lib/gamification/badge-engine': { checkAndAwardBadges: async () => { state.badges++; } } });
  return { state, route };
}

for (const [role, rank] of [['MEMBER', 5], ['MANAGER', 10], ['ADMIN', 10], ['OWNER', 10]]) test(`bingo enforces ${role} visible strength rank and active organization scope`, async () => {
  const { route, state } = bingo(role);
  assert.equal((await route.POST(req({ row: 0, col: 0, memberId: 'peer' }), context)).status, 200);
  assert.deepEqual(state.queries[0].where, { id: 'peer', organizationId: 'org', status: 'ACTIVE', strengths: { some: { theme: { name: 'Achiever' }, rank: { lte: rank } } } });
});

test('bingo rejects self, fractional coordinates and malformed persisted boards without querying peer strength', async () => {
  for (const body of [{ row: 0.5, col: 0, memberId: 'peer' }, { row: 0, col: -1, memberId: 'peer' }, { row: 0, col: 0, memberId: 'me' }]) {
    const { route, state } = bingo(); const result = await route.POST(req(body), context); assert.ok([400, 422].includes(result.status)); assert.equal(state.queries.length, 0);
  }
  const malformed = bingo('MEMBER', [board()[0]]);
  assert.equal((await malformed.route.POST(req({ row: 0, col: 0, memberId: 'peer' }), context)).status, 422); assert.equal(malformed.state.queries.length, 0);
});

test('missing hidden or foreign strength produces a generic denial and no board write', async () => {
  const { route, state } = bingo('MEMBER', board(), { targetMissing: true });
  const response = await route.POST(req({ row: 0, col: 0, memberId: 'foreign' }), context);
  assert.equal(response.status, 400); assert.equal(state.updates.length, 0); assert.equal(state.awards, 0);
  assert.ok(!JSON.stringify(await response.json()).includes('top 10'));
});

test('first winning transition awards once and repeated square or later winning squares cannot repeat reward', async () => {
  const squares = board(); for (let col = 0; col < 4; col++) squares[0][col].marked = true;
  const { route, state } = bingo('MEMBER', squares);
  assert.equal((await route.POST(req({ row: 0, col: 4, memberId: 'peer' }), context)).status, 200);
  assert.equal(state.awards, 50); assert.equal(state.badges, 1);
  assert.equal((await route.POST(req({ row: 0, col: 4, memberId: 'peer' }), context)).status, 409);
  assert.equal((await route.POST(req({ row: 1, col: 0, memberId: 'peer' }), context)).status, 200);
  assert.equal(state.awards, 50); assert.equal(state.badges, 1); assert.ok(state.participant.completedAt);
});

test('diagonal completion honors configured win condition', async () => {
  for (const [winCondition, wins] of [['row_or_column', false], ['diagonal', true], ['full_board', false]]) {
    const squares = board(); for (let i = 0; i < 4; i++) squares[i][i].marked = true;
    const { route, state } = bingo('MEMBER', squares, { rules: { winCondition } });
    const response = await route.POST(req({ row: 4, col: 4, memberId: 'peer' }), context);
    assert.equal((await response.json()).data.hasWon, wins); assert.equal(state.awards, wins ? 50 : 0);
  }
});

test('challenge detail never returns another participant board containing hidden match identities', async () => {
  let query;
  const prisma = { teamChallenge: { findFirst: async args => { query = args; return { ...challenge({}), name: 'C', description: 'D', startsAt: new Date(), endsAt: new Date(), rewards: {}, participants: [{ memberId: 'peer', score: 1, progress: { privateStrengthMatch: 'hidden' }, completedAt: null, member: { user: { fullName: 'Peer', avatarUrl: null }, strengths: [] } }] }; } } };
  const route = loadModule('src/app/api/challenges/[challengeId]/route.ts', base(prisma));
  const response = await route.GET(req({}), context); assert.equal(response.status, 200);
  assert.deepEqual(query.include.participants.where, { member: { organizationId: 'org', status: 'ACTIVE' } });
  assert.ok(!JSON.stringify(await response.json()).includes('privateStrengthMatch'));
});
