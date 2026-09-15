const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadModule } = require('./load-module.cjs');
let database;
try { database = new URL(process.env.DATABASE_URL || ''); } catch {}
if (!database || !['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost'].includes(database.hostname) || database.port !== '55487' || database.pathname !== '/strengthsync_security' || database.search) {
  throw new Error('Auth integration tests require disposable loopback PostgreSQL port 55487 database strengthsync_security');
}
process.env.NEXTAUTH_SECRET = 'test-only-auth-integration-secret';
process.env.NEXTAUTH_URL = 'https://app.example.test';
delete process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER;
const prisma = new PrismaClient(), secondPrisma = new PrismaClient();
const prefix = `auth-test-${randomUUID()}`;
const keys = new Set(), ids = [], orgIds = [];
const limiter = loadModule('src/lib/auth/request-protection.ts', { '@/lib/prisma': { prisma } });
const secondLimiter = loadModule('src/lib/auth/request-protection.ts', { '@/lib/prisma': { prisma: secondPrisma } });
function bucket(suffix, limit = 10) { const value = { scope: `${prefix}:${suffix}`, identity: 'synthetic-recipient@example.test', limit }; keys.add(limiter.authRateKey(value.scope, value.identity)); return value; }
const sha = value => createHash('sha256').update(value).digest('hex');
const request = (path, body) => new Request(`https://app.example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function account(invited = false) {
  const token = randomBytes(32).toString('hex');
  const user = await prisma.user.create({ data: { email: `${prefix}-${ids.length}@example.test`, fullName: 'Synthetic Recipient', passwordHash: 'untrusted-supplied-hash', emailVerifyToken: sha(token), emailVerifyExpires: new Date(Date.now() + 3600000) } });
  ids.push(user.id);
  if (!invited) return { user, token };
  const org = await prisma.organization.create({ data: { name: 'Synthetic Invitation', slug: `${prefix}-${orgIds.length}` } }); orgIds.push(org.id);
  const member = await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, status: 'PENDING', role: 'MEMBER' } });
  const email = loadModule('src/lib/auth/account-emails.ts', { '@/lib/prisma': { prisma } });
  return { user, token, member, invitation: email.createInvitationToken(member) };
}
const verification = () => loadModule('src/lib/auth/email-verification.ts', { '@/lib/prisma': { prisma } });
test.after(async () => {
  await prisma.authRateLimit.deleteMany({ where: { key: { in: [...keys] } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await Promise.all([prisma.$disconnect(), secondPrisma.$disconnect()]);
});

test('forty simultaneous sign-in reservations admit exactly ten and persist only private keys', async () => {
  const target = bucket('parallel');
  const outcomes = await Promise.allSettled(Array.from({ length: 40 }, () => limiter.consumeAuthLimits([target])));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 10);
  assert.ok(outcomes.filter(result => result.status === 'rejected').every(result => result.reason.status === 429));
  const rows = await prisma.authRateLimit.findMany({ where: { key: limiter.authRateKey(target.scope, target.identity) } });
  assert.equal(rows.length, 1); assert.equal(rows[0].count, 10); assert.ok(!JSON.stringify(rows).includes(target.identity));
});

test('independent Prisma clients enforce one shared recipient allowance', async () => {
  const target = bucket('instances', 3);
  const outcomes = await Promise.allSettled(Array.from({ length: 16 }, (_, index) => (index % 2 ? limiter : secondLimiter).consumeAuthLimits([target])));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 3);
});

test('expired counters reset atomically without a growing row per request', async () => {
  const target = bucket('expired', 2), key = limiter.authRateKey(target.scope, target.identity);
  await prisma.authRateLimit.create({ data: { key, count: 2, expiresAt: new Date(Date.now() - 1000) } });
  await limiter.consumeAuthLimits([target]);
  const row = await prisma.authRateLimit.findUnique({ where: { key } });
  assert.equal(row.count, 1); assert.ok(row.expiresAt > new Date());
});

test('global allowance blocks changing identities while all attempts commit bounded counters', async () => {
  const global = bucket('global', 2);
  await limiter.consumeAuthLimits([global, bucket('recipient-a', 10)]);
  await limiter.consumeAuthLimits([global, bucket('recipient-b', 10)]);
  await assert.rejects(limiter.consumeAuthLimits([global, bucket('recipient-c', 10)]), error => error.status === 429);
  assert.equal((await prisma.authRateLimit.findUnique({ where: { key: limiter.authRateKey(global.scope, global.identity) } })).count, 2);
});

test('new user defaults require verification while a legacy exemption never asserts email ownership', async () => {
  const { user } = await account();
  assert.equal(user.emailVerificationRequired, true); assert.equal(user.emailVerified, false);
  await prisma.user.update({ where: { id: user.id }, data: { emailVerificationRequired: false } });
  const legacy = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(legacy.emailVerificationRequired, false); assert.equal(legacy.emailVerified, false);
});

test('racing verification links set recipient credentials exactly once and invalidate outstanding resets', async () => {
  const { user, token } = await account();
  await prisma.user.update({ where: { id: user.id }, data: { passwordResetToken: sha('old-reset'), passwordResetExpires: new Date(Date.now() + 3600000) } });
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => verification().consumeEmailVerification(token, `recipient-chosen-${i}`)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const stored = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(stored.emailVerified, true); assert.match(stored.passwordHash, /^recipient-chosen-/);
  assert.equal(stored.emailVerifyToken, null); assert.equal(stored.emailVerifyExpires, null); assert.equal(stored.passwordResetToken, null);
  await assert.rejects(verification().consumeEmailVerification(token, 'replay-password'));
});

test('invitation verification atomically binds recipient organization role and pending membership', async () => {
  const { user, token, member, invitation } = await account(true);
  await verification().consumeEmailVerification(token, 'recipient-password', invitation);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).emailVerified, true);
  assert.equal((await prisma.organizationMember.findUnique({ where: { id: member.id } })).status, 'ACTIVE');
  await assert.rejects(verification().consumeEmailVerification(token, 'replay-password', invitation));
});

test('changed or canceled invitations cannot activate membership or consume verification', async () => {
  for (const cancel of [false, true]) {
    const { user, token, member, invitation } = await account(true);
    if (cancel) await prisma.organizationMember.delete({ where: { id: member.id } });
    else await prisma.organizationMember.update({ where: { id: member.id }, data: { role: 'ADMIN' } });
    await assert.rejects(verification().consumeEmailVerification(token, 'forbidden-password', invitation));
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored.emailVerified, false); assert.equal(stored.emailVerifyToken, sha(token)); assert.equal(stored.passwordHash, 'untrusted-supplied-hash');
  }
});

test('recipient mismatch and expired verification cannot be exchanged for another account', async () => {
  const first = await account(true), second = await account();
  await assert.rejects(verification().consumeEmailVerification(second.token, 'forbidden-password', first.invitation));
  await prisma.user.update({ where: { id: second.user.id }, data: { emailVerifyExpires: new Date(Date.now() - 1000) } });
  await assert.rejects(verification().consumeEmailVerification(second.token, 'forbidden-password'));
  assert.equal((await prisma.user.findUnique({ where: { id: second.user.id } })).emailVerified, false);
});


test('actual registration and verification handlers require recipient-chosen password before sign-in', async () => {
  const email = `${prefix}-signup@example.test`, delivered = [];
  const boundary = {
    '@/lib/prisma': { prisma },
    '@/lib/auth/request-protection': { ...limiter, protectAuthRequest: async () => {}, protectAccountEmail: async () => {} },
    '@/lib/email/resend': { isEmailConfigured: () => true, sendEmail: async message => { delivered.push(message); return { success: true }; } },
  };
  const registration = loadModule('src/app/api/auth/register/route.ts', boundary);
  const createdResponse = await registration.POST(request('/api/auth/register', { email, fullName: 'Synthetic Signup', organizationName: `${prefix} Signup`, password: 'SuppliedPassword123' }));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).data; ids.push(created.userId); orgIds.push(created.organizationId);
  assert.equal(created.verificationRequired, true); assert.equal(created.verificationSent, true); assert.equal(delivered[0].to, email);
  const { authOptions } = loadModule('src/lib/auth/config.ts', boundary);
  const login = password => authOptions.providers[0].options.authorize({ email, password }, { headers: {} });
  await assert.rejects(login('SuppliedPassword123'), /EmailVerificationRequired/);
  const token = new URL(delivered[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  const route = loadModule('src/app/api/auth/verify-email/route.ts', boundary);
  assert.equal((await route.POST(request('/api/auth/verify-email', { token, password: 'RecipientPassword456' }))).status, 200);
  await assert.rejects(login('SuppliedPassword123'), /Invalid email or password/);
  assert.equal((await login('RecipientPassword456')).id, created.userId);
  assert.equal((await route.POST(request('/api/auth/verify-email', { token, password: 'ReplayedPassword789' }))).status, 400);
});

test('actual new-member handler sends setup requiring explicit recipient consent and hides credentials', async () => {
  const org = await prisma.organization.create({ data: { name: 'Synthetic Admin Org', slug: `${prefix}-admin-org` } }); orgIds.push(org.id);
  const delivered = [], email = `${prefix}-admin-invite@example.test`;
  const boundary = {
    '@/lib/prisma': { prisma }, '@/lib/auth/config': { authOptions: {} },
    'next-auth': { getServerSession: async () => ({ user: { id: 'synthetic-owner', organizationId: org.id, role: 'OWNER' } }) },
    '@/lib/auth/request-protection': { ...limiter, protectAuthRequest: async () => {}, protectAccountEmail: async () => {} },
    '@/lib/email/resend': { isEmailConfigured: () => true, sendEmail: async message => { delivered.push(message); return { success: true }; } },
  };
  const route = loadModule('src/app/api/admin/members/route.ts', boundary);
  const response = await route.POST(request('/api/admin/members', { email, fullName: 'Synthetic Invite' }));
  assert.equal(response.status, 201); const created = (await response.json()).data; ids.push(created.userId);
  assert.equal(created.status, 'PENDING'); assert.ok(!('tempPassword' in created)); assert.equal(created.invitationSent, true);
  const before = await prisma.user.findUnique({ where: { id: created.userId } }); assert.equal(before.passwordHash, null);
  const url = new URL(delivered[0].text.match(/https:\/\/\S+/)[0]);
  const setup = loadModule('src/app/api/auth/verify-email/route.ts', boundary);
  const body = { token: url.searchParams.get('token'), invitation: url.searchParams.get('invitation'), password: 'RecipientPassword456' };
  assert.equal((await setup.POST(request('/api/auth/verify-email', body))).status, 400);
  assert.equal((await setup.POST(request('/api/auth/verify-email', { ...body, acceptInvitation: true }))).status, 200);
  assert.equal((await prisma.organizationMember.findUnique({ where: { id: created.id } })).status, 'ACTIVE');
  assert.equal((await prisma.user.findUnique({ where: { id: created.userId } })).emailVerified, true);
});

test('parallel verification email issuance sends once and stores only the issued token hash', async () => {
  const { user } = await account();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifyToken: null, emailVerifyExpires: null } });
  const delivered = [];
  const helper = loadModule('src/lib/auth/account-emails.ts', {
    '@/lib/prisma': { prisma }, '@/lib/auth/request-protection': { ...limiter, protectAccountEmail: async () => {} },
    '@/lib/email/resend': { isEmailConfigured: () => true, sendEmail: async message => { delivered.push(message); return { success: true }; } },
  });
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => helper.sendEmailVerification(user)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1); assert.equal(delivered.length, 1);
  const raw = new URL(delivered[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  const stored = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(stored.emailVerifyToken, sha(raw)); assert.notEqual(stored.emailVerifyToken, raw);
});
