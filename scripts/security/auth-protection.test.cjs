const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./load-module.cjs');
const request = (path, body, method = 'POST') => new Request(`https://app.example.test${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const secretBefore = process.env.NEXTAUTH_SECRET;
const headerBefore = process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER;
process.env.NEXTAUTH_SECRET = 'test-only-auth-rate-key-secret';
delete process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER;
test.after(() => { if (secretBefore === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = secretBefore; if (headerBefore === undefined) delete process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER; else process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER = headerBefore; });
const base = loadModule('src/lib/auth/request-protection.ts', { '@/lib/prisma': { prisma: {} } });
const allow = { ...base, protectAuthRequest: async () => {}, protectAccountEmail: async () => {} };

test('forwarded headers are untrusted by default and explicit proxy input must be single valid IP', () => {
  assert.equal(base.trustedClientIdentity(new Headers({ 'x-forwarded-for': '203.0.113.12', 'x-real-ip': '203.0.113.13' })), 'shared-source');
  process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER = 'x-strengthsync-client-ip';
  try {
    assert.equal(base.trustedClientIdentity(new Headers({ 'x-strengthsync-client-ip': '203.0.113.12' })), '203.0.113.12');
    assert.equal(base.trustedClientIdentity({ 'x-strengthsync-client-ip': '2001:db8:1:2::8' }), base.trustedClientIdentity({ 'x-strengthsync-client-ip': '2001:0db8:0001:0002:0:0:0:9' }));
    for (const value of [undefined, '', '203.0.113.12, 203.0.113.13', 'localhost', ['203.0.113.12']]) assert.throws(() => base.trustedClientIdentity({ 'x-strengthsync-client-ip': value }), error => error.status === 503);
    process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER = 'x-forwarded-for';
    assert.throws(() => base.trustedClientIdentity(new Headers()), error => error.status === 503);
  } finally { delete process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER; }
});

test('rate keys conceal addresses and separate action identities', () => {
  const key = base.authRateKey('sign-in', 'recipient@example.test');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!key.includes('recipient'));
  assert.notEqual(key, base.authRateKey('reset', 'recipient@example.test'));
});

test('bounded reads reject chunked bodies without content-length and UTF-8 bcrypt truncation', async () => {
  await assert.rejects(base.readAuthJson(request('/api/auth/register', { name: 'a'.repeat(18000) })), error => error.status === 413);
  await assert.rejects(base.readAuthJson(new Request('https://app.example.test', { method: 'POST', body: '{' })), error => error.status === 400);
  assert.equal(base.passwordSchema.safeParse('é'.repeat(36)).success, true);
  assert.equal(base.passwordSchema.safeParse('é'.repeat(37)).success, false);
});

test('database errors prevent sign-in before credential comparison or account lookup', async () => {
  let reads = 0, compares = 0;
  const { authOptions } = loadModule('src/lib/auth/config.ts', {
    '@/lib/prisma': { prisma: { $transaction: async () => { throw Error('storage unavailable'); }, user: { findUnique: async () => { reads++; } } } },
    bcryptjs: { compare: async () => { compares++; return true; } },
  });
  await assert.rejects(authOptions.providers[0].options.authorize({ email: 'r@example.test', password: 'Password123' }, { headers: {} }), /protection is unavailable/);
  assert.equal(reads + compares, 0);
});

test('sign-in preserves unverified legacy accounts but blocks required unverified accounts and sessions', async () => {
  const user = { id: 'r', email: 'r@example.test', fullName: 'R', passwordHash: 'old-hash', emailVerified: false, emailVerificationRequired: false, organizationMemberships: [] };
  const { authOptions } = loadModule('src/lib/auth/config.ts', { '@/lib/auth/request-protection': allow,
    '@/lib/prisma': { prisma: { user: { findUnique: async () => user, update: async () => {} } } }, bcryptjs: { compare: async () => true } });
  const login = () => authOptions.providers[0].options.authorize({ email: user.email, password: 'legacy-password'.repeat(8) }, { headers: {} });
  const signed = await login(); assert.equal(signed.id, user.id); assert.equal(user.emailVerified, false);
  user.emailVerificationRequired = true;
  await assert.rejects(login(), /EmailVerificationRequired/);
  await assert.rejects(authOptions.callbacks.jwt({ token: { id: user.id, credentialVersion: signed.credentialVersion } }), /no longer valid/);
  user.emailVerified = true; assert.equal((await login()).id, user.id);
});

for (const [path, payload] of [
  ['register', { email: 'r@example.test', fullName: 'Recipient', organizationName: 'Org', password: 'Password123' }],
  ['join', { email: 'r@example.test', fullName: 'Recipient', inviteCode: 'CODE', password: 'Password123' }],
  ['forgot-password', { email: 'r@example.test' }],
  ['reset-password', { token: 'a'.repeat(64), password: 'Password123' }],
  ['resend-verification', { email: 'r@example.test' }],
  ['verify-email', { token: 'a'.repeat(64), password: 'Password123' }],
]) test(`${path} actual handler fails closed when limiter storage is unavailable`, async () => {
  let reads = 0;
  const prisma = { $transaction: async () => { throw Error('unavailable'); }, user: { findUnique: async () => { reads++; }, findFirst: async () => { reads++; } } };
  const route = loadModule(`src/app/api/auth/${path}/route.ts`, { '@/lib/prisma': { prisma } });
  assert.equal((await route.POST(request(`/api/auth/${path}`, payload))).status, 503);
  assert.equal(reads, 0);
});

test('register and join reject missing email configuration before any account is created', async () => {
  for (const path of ['register', 'join']) {
    let writes = 0;
    const route = loadModule(`src/app/api/auth/${path}/route.ts`, {
      '@/lib/auth/request-protection': allow,
      '@/lib/auth/account-emails': { requireInvitationEmail() { throw Error('Email unavailable'); } },
      '@/lib/prisma': { prisma: { $transaction() { writes++; } } },
    });
    const response = await route.POST(request(`/api/auth/${path}`, { email: 'r@example.test', password: 'Password123', fullName: 'Recipient', organizationName: 'Org', inviteCode: 'CODE' }));
    assert.equal(response.status, 500); assert.equal(writes, 0);
  }
});

test('verification handler requires explicit invitation consent before password hashing', async () => {
  let hashes = 0;
  const route = loadModule('src/app/api/auth/verify-email/route.ts', { '@/lib/auth/request-protection': allow, '@/lib/prisma': { prisma: {} }, bcryptjs: { hash: async () => { hashes++; } } });
  assert.equal((await route.POST(request('/api/auth/verify-email', { token: 'a'.repeat(64), password: 'Password123', invitation: 'signed-claim' }))).status, 400);
  assert.equal(hashes, 0);
});

test('verification consumption rechecks token and invitation and rolls back on canceled consent', async () => {
  const claims = { userId: 'recipient', memberId: 'member', organizationId: 'org', role: 'MEMBER', version: new Date().toISOString() };
  let writes = [], rolledBack = false;
  const prisma = {
    user: { findFirst: async () => ({ id: 'recipient', email: 'r@example.test' }) },
    organizationMember: { findFirst: async () => ({ organization: { name: 'Org' }, role: 'MEMBER' }) },
    $transaction: async fn => { try { return await fn({ user: { updateMany: async args => { writes.push(args); return { count: 1 }; } }, organizationMember: { updateMany: async args => { writes.push(args); return { count: 0 }; } } }); } catch (error) { rolledBack = true; throw error; } },
  };
  const helper = loadModule('src/lib/auth/email-verification.ts', { '@/lib/prisma': { prisma }, '@/lib/auth/account-emails': { hashResetToken: () => 'hash-of-link', readInvitationToken: () => claims } });
  await assert.rejects(helper.consumeEmailVerification('a'.repeat(64), 'recipient-chosen-hash', 'invite'), /invitation changed/);
  assert.equal(rolledBack, true);
  assert.equal(writes[0].where.emailVerifyToken, 'hash-of-link');
  assert.equal(writes[0].where.emailVerified, false);
  assert.equal(writes[0].data.passwordHash, 'recipient-chosen-hash');
  assert.equal(writes[0].data.passwordResetToken, null);
  assert.deepEqual(writes[1].where, { id: 'member', userId: 'recipient', organizationId: 'org', role: 'MEMBER', status: 'PENDING', updatedAt: new Date(claims.version) });
});

test('verification emails store hashed expiring tokens, bind recipient, and never reuse supplied passwords', async () => {
  const previous = process.env.NEXTAUTH_URL; process.env.NEXTAUTH_URL = 'https://app.example.test';
  try {
    let write, email;
    const helper = loadModule('src/lib/auth/account-emails.ts', { '@/lib/auth/request-protection': allow,
      '@/lib/prisma': { prisma: { user: { updateMany: async args => { write = args; return { count: 1 }; } } } },
      '@/lib/email/resend': { isEmailConfigured: () => true, sendEmail: async args => { email = args; return { success: true }; } },
    });
    await helper.sendEmailVerification({ id: 'recipient', email: 'r@example.test', fullName: '<script>bad</script>' });
    const url = new URL(email.text.match(/https:\/\/\S+/)[0]);
    assert.equal(write.data.emailVerifyToken, helper.hashResetToken(url.searchParams.get('token')));
    assert.equal(write.where.email, 'r@example.test'); assert.equal(write.where.emailVerified, false);
    assert.ok(write.data.emailVerifyExpires > new Date()); assert.ok(!('passwordHash' in write.data));
    assert.ok(!email.html.includes('<script>')); assert.equal(email.to, 'r@example.test');
  } finally { if (previous === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = previous; }
});

test('invitation expiry while waiting for a transaction prevents credential and membership writes', async () => {
  const claims = { userId: 'r', memberId: 'm', organizationId: 'o', role: 'MEMBER', version: new Date().toISOString(), expiresAt: Date.now() + 20 };
  let writes = 0;
  const helper = loadModule('src/lib/auth/email-verification.ts', {
    '@/lib/prisma': { prisma: {
      user: { findFirst: async () => ({ id: 'r', email: 'r@example.test' }) },
      organizationMember: { findFirst: async () => ({ organization: { name: 'O' }, role: 'MEMBER' }) },
      $transaction: async fn => { await new Promise(resolve => setTimeout(resolve, 50)); return fn({ user: { updateMany: async () => { writes++; return { count: 1 }; } } }); },
    } }, '@/lib/auth/account-emails': { hashResetToken: value => value, readInvitationToken: () => claims },
  });
  await assert.rejects(helper.consumeEmailVerification('token', 'hash', 'invite'), /expired before acceptance/);
  assert.equal(writes, 0);
});
