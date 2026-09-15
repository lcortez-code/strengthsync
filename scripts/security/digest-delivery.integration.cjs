const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadModule } = require('./load-module.cjs');
let database;
try { database = new URL(process.env.DATABASE_URL || ''); } catch {}
if (!database || !['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1','localhost'].includes(database.hostname) || database.port !== '55487' || database.pathname !== '/strengthsync_security' || database.search) throw new Error('Disposable security database required');
const prisma = new PrismaClient();
const prefix = `digest-test-${randomUUID()}`;
const delivery = loadModule('src/lib/email/digest-delivery.ts', { '@/lib/prisma': { prisma } });
const start = new Date('2026-09-07T00:00:00Z'), end = new Date('2026-09-14T00:00:00Z');
const recipient = (org = 'a', user = 'one') => ({ userId: `${prefix}-${user}`, organizationId: `${prefix}-${org}`, memberId: `${prefix}-${org}-${user}` });
test.after(async () => { await prisma.emailDigestLog.deleteMany({where:{userId:{startsWith:prefix}}}); await prisma.$disconnect(); });
test('twenty concurrent dispatches acquire exactly one pending claim', async () => {
  const result = await Promise.all(Array.from({length:20},()=>delivery.claimDigestDelivery(recipient(),start,end)));
  assert.equal(result.filter(Boolean).length,1);
  const row = await prisma.emailDigestLog.findUnique({where:{id:result.find(Boolean)}});
  assert.equal(row.status,'PENDING'); assert.equal(row.organizationId, recipient().organizationId);
  for (const status of ['SENT','FAILED','BOUNCED','SKIPPED']) {
    await prisma.emailDigestLog.update({where:{id:row.id},data:{status}});
    assert.equal(await delivery.claimDigestDelivery(recipient(),start,end),null);
  }
});
test('same account receives independent organization deliveries while legacy ambiguous claims stay suppressed', async () => {
  const a = await delivery.claimDigestDelivery(recipient('a','multi'),start,end);
  const b = await delivery.claimDigestDelivery(recipient('b','multi'),start,end);
  assert.ok(a && b && a !== b);
  await prisma.emailDigestLog.create({data:{userId:recipient('a','legacy').userId,digestType:'WEEKLY',periodStart:start,periodEnd:end,status:'PENDING'}});
  assert.equal(await delivery.claimDigestDelivery(recipient('b','legacy'),start,end),null);
  assert.ok(await delivery.claimDigestDelivery(recipient('b','legacy'),start,end,true));
});
