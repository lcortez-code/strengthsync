const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./load-module.cjs');
const { NextRequest } = require('next/server');

test('scheduler GET requires exact nonempty header and rejects all query parameters', async () => {
  const old = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'synthetic-scheduler-secret';
  let dispatched = 0;
  const route = loadModule('src/app/api/cron/weekly-digest/route.ts', {
    '@/app/api/email/digest/route': { POST: async request => {
      assert.equal(request.method, 'POST');
      assert.equal(new URL(request.url).search, '');
      dispatched++; return new Response('{}');
    } },
    '@/lib/prisma': { prisma: {} },
  });
  try {
    for (const headers of [{}, { authorization: 'synthetic-scheduler-secret' }, { authorization: 'Bearer wrong' }]) {
      assert.equal((await route.GET(new NextRequest('https://app.example.test/api/cron/weekly-digest', { headers }))).status, 401);
    }
    for (const query of ['?test=true', '?userId=foreign', '?secret=synthetic-scheduler-secret']) {
      assert.equal((await route.GET(new NextRequest('https://app.example.test/api/cron/weekly-digest'+query, { headers: { authorization: 'Bearer synthetic-scheduler-secret' } }))).status, 400);
    }
    assert.equal(dispatched, 0);
    const result = await route.GET(new NextRequest('https://app.example.test/api/cron/weekly-digest', { headers: { authorization: 'Bearer synthetic-scheduler-secret' } }));
    assert.equal(result.status, 200); assert.equal(dispatched, 1);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  } finally { if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old; }
});

test('usage metadata never retains prompt, completion or exception content; legacy errors are classified', async () => {
  const updates = [];
  const tracker = loadModule('src/lib/ai/token-tracker.ts', {
    '@/lib/prisma': { prisma: { aIUsageLog: {
      findFirst: async () => ({ id: 'r', reservedTokens: 100, settledAt: null }),
      updateMany: async args => { updates.push(args); return { count: 1 }; },
      findMany: async args => { assert.equal(args.select.errorMessage, false); return [{ id: 'legacy', feature: 'chat', createdAt: new Date(), memberId: 'm' }]; },
    } } }, './client': { calculateCost: () => 0 },
  });
  for (const success of [true, false]) {
    await tracker.logUsage({ reservationId: 'r', memberId: 'm', organizationId: 'o', feature: 'chat', endpoint: '/api/ai/chat',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, model: 'test', latencyMs: 1 }, usageKnown: true,
      requestSummary: 'private prompt', responseSummary: 'private response', errorMessage: 'provider secret payload', success });
  }
  for (const { data } of updates) {
    assert.equal(data.requestSummary, null); assert.equal(data.responseSummary, null);
    assert.ok(data.errorMessage === null || data.errorMessage === 'generation_failed');
    assert.doesNotMatch(JSON.stringify(data), /private|secret payload/);
  }
  assert.equal((await tracker.getRecentErrors('o'))[0].errorMessage, 'generation_failed');
});

test('conversation deletion erases content only after an owned active row is claimed', async () => {
  for (const owned of [false, true]) {
    let erased = 0;
    const prisma = {
      aIConversation: { updateMany: async ({where,data}) => {
        assert.deepEqual(where, { id: 'conversation', memberId: 'member', organizationId: 'org', status: 'ACTIVE' });
        assert.equal(data.title, 'Deleted conversation'); assert.equal(data.status, 'DELETED');
        return { count: owned ? 1 : 0 };
      } },
      aIMessage: { deleteMany: async ({where}) => { assert.deepEqual(where,{conversationId:'conversation'}); erased++; } },
      $transaction: async work => work(prisma),
    };
    const route = loadModule('src/app/api/ai/chat/conversations/[conversationId]/route.ts', {
      '@/lib/prisma': { prisma }, '@/lib/auth/config': { authOptions: {} },
      'next-auth': { getServerSession: async () => ({user:{id:'user',memberId:'member',organizationId:'org'}}) },
    });
    const response = await route.DELETE(new NextRequest('https://app.example.test/api'), {params:Promise.resolve({conversationId:'conversation'})});
    assert.equal(response.status, owned ? 200 : 404); assert.equal(erased, owned ? 1 : 0);
  }
});
