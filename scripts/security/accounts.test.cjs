const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: loadActualModule } = require('./load-module.cjs');
const protection = loadActualModule('src/lib/auth/request-protection.ts', { '@/lib/prisma': { prisma: {} } });
// Account authorization tests isolate the separately tested durable limiter boundary.
const loadModule = (path, mocks = {}) => loadActualModule(path, { '@/lib/auth/request-protection': { ...protection, protectAuthRequest: async () => {}, protectAccountEmail: async () => {} }, ...mocks });
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const request = (path, body, method = 'POST') => new Request('https://app.example.test' + path, {
  method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
});
const session = role => ({ user: { id: 'actor-user', memberId: 'actor-member', organizationId: 'org-a', role } });
const authMocks = (prisma, current = session('OWNER'), extra = {}) => ({
  '@/lib/prisma': { prisma }, 'next-auth': { getServerSession: async () => current },
  '@/lib/auth/config': { authOptions: {} },
  ...extra,
});
const emailDoubles = extra => ({
  requireInvitationEmail() {}, async sendOrganizationInvitation() {}, async sendPasswordReset() {},
  ResetEmailCooldownError: class extends Error {}, VerificationEmailCooldownError: class extends Error {},
  async sendMemberInvitation(member) { return (extra?.sendOrganizationInvitation || (async () => {}))(member, member.user.email, member.organization?.name); }, ...extra,
});
const pending = () => ({ id: 'invite-member', userId: 'recipient', organizationId: 'org-a', role: 'MEMBER', status: 'PENDING', updatedAt: new Date('2026-09-15T01:00:00Z') });

function emailModule(prisma, deliver = async () => ({ success: true })) {
  return loadModule('src/lib/auth/account-emails.ts', {
    '@/lib/prisma': { prisma },
    '@/lib/email/resend': { isEmailConfigured: () => true, sendEmail: deliver },
  });
}

test('signed invitations reject modification and expiry, and bind every consent field', () => {
  const before = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'test-only-signing-secret';
  try {
    const { createInvitationToken, readInvitationToken } = emailModule({});
    const member = pending();
    const token = createInvitationToken(member, 1000);
    const claims = readInvitationToken(token, 1001);
    for (const key of ['userId', 'organizationId', 'role']) assert.equal(claims[key], member[key]);
    assert.equal(claims.memberId, member.id);
    assert.equal(claims.version, member.updatedAt.toISOString());
    assert.equal(readInvitationToken(token, 1000 + 7 * 86400000), null);
    const [payload, signature] = token.split('.');
    const changed = JSON.parse(Buffer.from(payload, 'base64url'));
    changed.role = 'OWNER';
    assert.equal(readInvitationToken(Buffer.from(JSON.stringify(changed)).toString('base64url') + '.' + signature, 1001), null);
    assert.equal(readInvitationToken('x'.repeat(4097)), null);
  } finally { if (before === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = before; }
});

test('reset email stores only a hash, sends to the account email, and preserves password', async () => {
  const before = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'https://app.example.test';
  try {
    const writes = [], emails = [];
    const helper = emailModule({ user: { updateMany: async args => { writes.push(args); return { count: 1 }; } } }, async email => { emails.push(email); return { success: true }; });
    await helper.sendPasswordReset({ id: 'recipient', email: 'recipient@example.test', fullName: '<img src=x>' });
    assert.equal(emails[0].to, 'recipient@example.test');
    const url = emails[0].text.match(/https:\/\/\S+/)[0];
    const raw = new URL(url).searchParams.get('token');
    assert.equal(writes[0].data.passwordResetToken, sha(raw));
    assert.notEqual(writes[0].data.passwordResetToken, raw);
    assert.ok(!('passwordHash' in writes[0].data));
    assert.ok(!emails[0].html.includes('<img src=x>'));
    assert.ok(writes[0].where.OR.some(condition => condition.passwordResetExpires?.lte instanceof Date));
  } finally { if (before === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = before; }
});

test('reset issuance cooldown blocks concurrent email and failed delivery only clears its own token', async () => {
  const before = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'https://app.example.test';
  try {
    let sent = 0;
    const helper = emailModule({ user: { updateMany: async () => ({ count: 0 }) } }, async () => { sent++; });
    await assert.rejects(helper.sendPasswordReset({ id: 'r', email: 'r@example.test', fullName: 'R' }), helper.ResetEmailCooldownError);
    assert.equal(sent, 0);
    const writes = [];
    const failed = emailModule({ user: { updateMany: async args => { writes.push(args); return { count: 1 }; } } }, async () => ({ success: false }));
    await assert.rejects(failed.sendPasswordReset({ id: 'r', email: 'r@example.test', fullName: 'R' }));
    assert.equal(writes.length, 2);
    assert.equal(writes[1].where.passwordResetToken, writes[0].data.passwordResetToken);
    assert.equal(writes[1].data.passwordResetToken, null);
  } finally { if (before === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = before; }
});

test('single member create requires acceptance for an existing global account', async () => {
  let created, emailed;
  const prisma = {
    user: { findUnique: async () => ({ id: 'recipient', email: 'recipient@example.test', organizationMemberships: [] }) },
    organizationMember: { create: async args => { created = args; return { ...pending(), ...args.data, organization: { name: 'Test org' } }; } },
  };
  const route = loadModule('src/app/api/admin/members/route.ts', authMocks(prisma, session('OWNER'), {
    '@/lib/auth/account-emails': emailDoubles({ sendOrganizationInvitation: async (...args) => { emailed = args; } }),
  }));
  const response = await route.POST(request('/api/admin/members', { email: 'recipient@example.test', fullName: 'Attacker supplied name', role: 'ADMIN' }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(created.data.status, 'PENDING');
  assert.equal(created.data.role, 'ADMIN');
  assert.equal(emailed[1], 'recipient@example.test');
  assert.equal(body.data.invitationSent, true);
  assert.equal(body.data.name, 'Invitation pending');
  assert.ok(!('tempPassword' in body.data));
});

test('bulk import cannot attach profiles or strengths to existing accounts before acceptance', async () => {
  const writes = [], emails = [];
  const prisma = {
    strengthTheme: { findMany: async () => [] },
    user: { findUnique: async () => ({ id: 'recipient', email: 'recipient@example.test', organizationMemberships: [] }) },
    organizationMember: { create: async args => { writes.push(args); return { ...pending(), ...args.data, organization: { name: 'Org' } }; } },
    $transaction: () => { throw Error('Existing account must never enter profile/strength import transaction'); },
  };
  const route = loadModule('src/app/api/admin/members/bulk/route.ts', authMocks(prisma, session('OWNER'), {
    '@/lib/auth/account-emails': emailDoubles({ sendOrganizationInvitation: async (...args) => { emails.push(args); } }),
    '@/lib/pdf/parser': { parseCliftonStrengthsPDF: () => { throw Error('Must not parse a pending recipient PDF'); } },
  }));
  const form = new FormData();
  form.set('members[0].email', 'recipient@example.test'); form.set('members[0].fullName', 'Supplied name');
  form.set('members[0].pdf', new Blob(['%PDF-test'], { type: 'application/pdf' }), 'strengths.pdf');
  const response = await route.POST(new Request('https://app.example.test/api/admin/members/bulk', { method: 'POST', body: form }));
  assert.equal(response.status, 200);
  const result = (await response.json()).data.results[0];
  assert.equal(writes[0].data.status, 'PENDING');
  assert.equal(result.data.strengthsImported, false);
  assert.equal(result.data.invitationSent, true);
  assert.equal(emails[0][1], 'recipient@example.test');
  assert.ok(!('tempPassword' in result.data));
});

function managedRoute(actorRole = 'OWNER', target = {}) {
  const state = { locked: false, updated: [], removed: [], emailed: [], otherOwners: 1 };
  const actor = { id: 'actor-member', userId: 'actor-user', organizationId: 'org-a', status: 'ACTIVE', role: actorRole };
  const member = { ...pending(), status: 'ACTIVE', user: { id: 'recipient', email: 'recipient@example.test', fullName: 'Recipient' }, organization: { name: 'Org' }, ...target };
  const tx = {
    $queryRaw: async (parts, org) => { assert.ok(parts.join('?').includes('FOR UPDATE')); assert.equal(org, 'org-a'); state.locked = true; },
    organizationMember: {
      findFirst: async args => { assert.equal(state.locked, true); assert.equal(args.where.organizationId, 'org-a'); return args.where.id === actor.id ? actor : member; },
      count: async args => { assert.equal(args.where.status, 'ACTIVE'); assert.deepEqual(args.where.id, { not: member.id }); return state.otherOwners; },
      update: async args => { state.updated.push(args); return { ...member, ...args.data }; },
      delete: async args => { state.removed.push(args); },
    },
  };
  const prisma = { $transaction: async fn => fn(tx) };
  const route = loadModule('src/app/api/admin/members/[memberId]/route.ts', authMocks(prisma, session(actorRole), {
    '@/lib/auth/account-emails': emailDoubles({ sendPasswordReset: async user => { state.emailed.push(user); } }),
  }));
  const context = { params: Promise.resolve({ memberId: member.id }) };
  return { route, state, context, actor, member };
}

test('admin cannot deactivate, demote, delete or reset privileged memberships', async () => {
  for (const role of ['OWNER', 'ADMIN', 'MANAGER']) {
    for (const method of ['PATCH', 'DELETE', 'POST']) {
      const { route, context, state } = managedRoute('ADMIN', { role });
      const response = await route[method](request('/api/admin/members/member', method === 'PATCH' ? { status: 'INACTIVE' } : undefined, method), context);
      assert.equal(response.status, 403, `${method} ${role}`);
      assert.equal(state.updated.length + state.removed.length + state.emailed.length, 0);
    }
  }
});

test('pending invitations cannot be activated or reset by admins', async () => {
  const { route, context, state } = managedRoute('OWNER', { status: 'PENDING' });
  assert.equal((await route.PATCH(request('/api/admin/members/m', { status: 'ACTIVE' }, 'PATCH'), context)).status, 400);
  assert.equal((await route.POST(request('/api/admin/members/m'), context)).status, 400);
  assert.equal(state.updated.length + state.emailed.length, 0);
});

test('last active owner survives status change, demotion and deletion', async () => {
  for (const change of [{ status: 'INACTIVE' }, { role: 'MEMBER' }, null]) {
    const { route, context, state } = managedRoute('OWNER', { role: 'OWNER' });
    state.otherOwners = 0;
    const method = change ? 'PATCH' : 'DELETE';
    const response = await route[method](request('/api/admin/members/m', change || undefined, method), context);
    assert.equal(response.status, 400);
    assert.equal(state.updated.length + state.removed.length, 0);
  }
});

test('fresh locked actor authorization blocks stale owner sessions', async () => {
  const { route, context, actor } = managedRoute('OWNER');
  actor.role = 'MEMBER';
  assert.equal((await route.PATCH(request('/api/admin/members/m', { role: 'ADMIN' }, 'PATCH'), context)).status, 403);
});

test('admin reset sends a link only and returns no replacement credential', async () => {
  const { route, context, state } = managedRoute();
  const response = await route.POST(request('/api/admin/members/m'), context);
  assert.equal(response.status, 200);
  const body = (await response.json()).data;
  assert.equal(body.resetLinkSent, true);
  assert.ok(!('tempPassword' in body));
  assert.equal(state.emailed[0].email, 'recipient@example.test');
  assert.equal(state.updated.length, 0);
});

function invitationRoute({ userId = 'recipient', count = 1, exists = true } = {}) {
  const claims = { userId: 'recipient', organizationId: 'org-a', memberId: 'invite-member', role: 'MANAGER', version: new Date().toISOString(), expiresAt: Date.now() + 60000 };
  const state = { queries: [], writes: [] };
  const prisma = { organizationMember: {
    findFirst: async args => { state.queries.push(args); return exists ? { id: 'invite-member', role: 'MANAGER', organization: { name: 'Org' } } : null; },
    updateMany: async args => { state.writes.push(args); return { count }; },
  } };
  const route = loadModule('src/app/api/organizations/invitations/route.ts', authMocks(prisma, { user: { id: userId } }, {
    '@/lib/auth/account-emails': { readInvitationToken: () => claims },
  }));
  return { route, state, claims };
}

test('invitation acceptance requires matching authenticated recipient before DB access', async () => {
  const { route, state } = invitationRoute({ userId: 'attacker' });
  assert.equal((await route.POST(request('/api/organizations/invitations?token=test'))).status, 403);
  assert.equal(state.queries.length + state.writes.length, 0);
});

test('invitation accepts only unchanged pending user, organization and role and is single use', async () => {
  const { route, state, claims } = invitationRoute();
  assert.equal((await route.POST(request('/api/organizations/invitations?token=test'))).status, 200);
  assert.deepEqual(state.writes[0].where, { id: claims.memberId, userId: claims.userId, organizationId: claims.organizationId, role: claims.role, status: 'PENDING', updatedAt: new Date(claims.version) });
  assert.equal(state.writes[0].data.status, 'ACTIVE');
  const replay = invitationRoute({ count: 0 });
  assert.equal((await replay.route.POST(request('/api/organizations/invitations?token=test'))).status, 409);
  const canceled = invitationRoute({ exists: false });
  assert.equal((await canceled.route.POST(request('/api/organizations/invitations?token=test'))).status, 400);
  assert.equal(canceled.state.writes.length, 0);
});

test('forgot password returns the same response for known, unknown and delivery failure without a token', async () => {
  const responses = [];
  for (const mode of ['known', 'unknown', 'delivery-failure']) {
    const route = loadModule('src/app/api/auth/forgot-password/route.ts', {
      '@/lib/prisma': { prisma: { user: { findUnique: async () => mode === 'unknown' ? null : { id: 'r', email: 'r@example.test', fullName: 'R' } } } },
      '@/lib/auth/account-emails': emailDoubles({ sendPasswordReset: async () => { if (mode === 'delivery-failure') throw Error('synthetic delivery failure'); } }),
    });
    responses.push(await (await route.POST(request('/api/auth/forgot-password', { email: 'r@example.test' }))).json());
  }
  assert.deepEqual(responses[0], responses[1]); assert.deepEqual(responses[0], responses[2]);
  assert.ok(!JSON.stringify(responses).includes('devToken'));
});

test('reset atomically consumes a hashed unexpired token once under concurrent requests', async () => {
  const raw = 'a'.repeat(64), queries = [], writes = [];
  let used = false;
  const route = loadModule('src/app/api/auth/reset-password/route.ts', {
    '@/lib/prisma': { prisma: { user: {
      findFirst: async args => { queries.push(args); return { id: 'recipient' }; },
      updateMany: async args => { writes.push(args); const count = used ? 0 : 1; used = true; return { count }; },
    } } },
    '@/lib/auth/account-emails': { hashResetToken: sha }, bcryptjs: { hash: async () => 'synthetic-new-hash' },
  });
  const responses = await Promise.all([1, 2].map(() => route.POST(request('/api/auth/reset-password', { token: raw, password: 'NewPassword1' }))));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  assert.ok(queries.every(q => q.where.passwordResetToken === sha(raw)));
  assert.ok(writes.every(q => q.where.passwordResetToken === sha(raw) && q.where.passwordResetExpires.gt instanceof Date));
  assert.ok(writes.every(q => q.data.passwordResetToken === null && q.data.passwordResetExpires === null));
});

test('password change compares the verified old hash and invalidates outstanding reset links', async () => {
  let write;
  const route = loadModule('src/app/api/settings/password/route.ts', authMocks({ user: {
    findUnique: async () => ({ id: 'actor-user', passwordHash: 'old-synthetic-hash' }),
    updateMany: async args => { write = args; return { count: 1 }; },
  } }, session('OWNER'), { bcryptjs: { compare: async () => true, hash: async () => 'new-synthetic-hash' } }));
  const response = await route.PATCH(request('/api/settings/password', { currentPassword: 'OldPassword1', newPassword: 'NewPassword1', confirmPassword: 'NewPassword1' }, 'PATCH'));
  assert.equal(response.status, 200);
  assert.deepEqual(write.where, { id: 'actor-user', passwordHash: 'old-synthetic-hash' });
  assert.deepEqual(write.data, { passwordHash: 'new-synthetic-hash', passwordResetToken: null, passwordResetExpires: null });
});

test('login callback allows local invitation paths and rejects executable/external destinations', () => {
  const { safeAuthCallback } = loadModule('src/lib/auth/redirect.ts');
  for (const value of ['javascript:alert(1)', 'https://evil.test', '//evil.test', '/\\evil.test', '/\n/evil.test']) assert.equal(safeAuthCallback(value), '/dashboard');
  assert.equal(safeAuthCallback('/auth/invitation?token=example'), '/auth/invitation?token=example');
});

test('new-account temporary passwords use random server entropy and meet password rules', () => {
  const { generateTempPassword } = loadModule('src/lib/auth/temporary-password.ts');
  const first = generateTempPassword(), second = generateTempPassword();
  assert.notEqual(first, second); assert.ok(first.length >= 24); assert.match(first, /[A-Z]/); assert.match(first, /[a-z]/); assert.match(first, /[0-9]/);
});

test('pending member list masks global profile data and names cannot be used to search pending accounts', async () => {
  let query;
  const prisma = { organizationMember: {
    count: async () => 1,
    findMany: async args => { query = args; return [{
      ...pending(), points: 0, streak: 0, joinedAt: new Date(), strengths: [],
      _count: { shoutoutsGiven: 0, shoutoutsReceived: 0 },
      user: { id: 'recipient', email: 'recipient@example.test', fullName: 'Private full name', avatarUrl: 'https://private-avatar.test', department: 'Private department', jobTitle: 'Private title', lastLoginAt: new Date() },
    }]; },
  } };
  const route = loadModule('src/app/api/admin/members/route.ts', authMocks(prisma, session('OWNER'), { '@/lib/auth/account-emails': emailDoubles() }));
  const response = await route.GET(new Request('https://app.example.test/api/admin/members?search=Private&limit=1000000'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(query.take, 100);
  assert.equal(query.where.user.OR[0].organizationMemberships.some.status.not, 'PENDING');
  assert.equal(body.data[0].name, 'Invitation pending');
  assert.equal(body.data[0].jobTitle, null); assert.equal(body.data[0].department, null);
  assert.equal(body.data[0].avatarUrl, null); assert.equal(body.data[0].lastLoginAt, null);
  assert.ok(!JSON.stringify(body).includes('Private'));
});

test('new account creation requires recipient email setup and consent without an admin-known password', async () => {
  let userData, membershipData;
  const tx = {
    user: { create: async args => { userData = args.data; return { id: 'new-user', ...args.data }; } },
    organizationMember: { create: async args => { membershipData = args.data; return { id: 'new-member', ...args.data }; } },
  };
  const prisma = { user: { findUnique: async () => null }, $transaction: async fn => fn(tx) };
  const route = loadModule('src/app/api/admin/members/route.ts', authMocks(prisma, session('OWNER'), {
    '@/lib/auth/account-emails': emailDoubles(), bcryptjs: { hash: async value => 'hash:' + sha(value) },
  }));
  const response = await route.POST(request('/api/admin/members', { email: 'new@example.test', fullName: 'New Person' }));
  assert.equal(response.status, 201);
  const result = (await response.json()).data;
  assert.equal(result.isNewUser, true); assert.equal(result.status, 'PENDING');
  assert.equal(membershipData.userId, 'new-user');
  assert.equal(userData.passwordHash, null);
  assert.equal(userData.emailVerificationRequired, true);
  assert.equal(userData.emailVerified, false);
  assert.ok(!('tempPassword' in result));
  assert.ok(!('passwordHash' in result));
});

test('email delivery failure keeps a recoverable pending invitation without credentials', async () => {
  let created;
  const prisma = {
    user: { findUnique: async () => ({ id: 'recipient', email: 'recipient@example.test', organizationMemberships: [] }) },
    organizationMember: { create: async args => { created = args.data; return { ...pending(), ...args.data, organization: { name: 'Org' } }; } },
  };
  const route = loadModule('src/app/api/admin/members/route.ts', authMocks(prisma, session('OWNER'), {
    '@/lib/auth/account-emails': emailDoubles({ sendOrganizationInvitation: async () => { throw Error('synthetic delivery failure'); } }),
  }));
  const response = await route.POST(request('/api/admin/members', { email: 'recipient@example.test', fullName: 'Recipient' }));
  assert.equal(response.status, 201);
  const result = (await response.json()).data;
  assert.equal(created.status, 'PENDING'); assert.equal(result.invitationSent, false);
  assert.match(result.message, /Resend invitation/); assert.ok(!('tempPassword' in result));
});

test('owners can manage ordinary members while another active owner allows owner demotion', async () => {
  for (const role of ['MEMBER', 'OWNER']) {
    const { route, context, state } = managedRoute('OWNER', { role });
    const response = await route.PATCH(request('/api/admin/members/m', { role: 'MANAGER' }, 'PATCH'), context);
    assert.equal(response.status, 200);
    assert.equal(state.updated[0].data.role, 'MANAGER');
  }
});

test('reset does not overwrite a password when expiry occurs during hashing', async () => {
  const raw = 'b'.repeat(64);
  let expiry = Date.now() + 60000, password = 'old-hash';
  const route = loadModule('src/app/api/auth/reset-password/route.ts', {
    '@/lib/prisma': { prisma: { user: {
      findFirst: async () => ({ id: 'recipient' }),
      updateMany: async args => {
        const count = expiry > args.where.passwordResetExpires.gt.getTime() ? 1 : 0;
        if (count) password = args.data.passwordHash;
        return { count };
      },
    } } },
    '@/lib/auth/account-emails': { hashResetToken: sha },
    bcryptjs: { hash: async () => { expiry = Date.now() - 1000; return 'new-hash'; } },
  });
  assert.equal((await route.POST(request('/api/auth/reset-password', { token: raw, password: 'NewPassword1' }))).status, 400);
  assert.equal(password, 'old-hash');
});

test('settings password rejects a concurrent credential change instead of overwriting it', async () => {
  const route = loadModule('src/app/api/settings/password/route.ts', authMocks({ user: {
    findUnique: async () => ({ id: 'actor-user', passwordHash: 'old-hash' }),
    updateMany: async args => { assert.equal(args.where.passwordHash, 'old-hash'); return { count: 0 }; },
  } }, session('OWNER'), { bcryptjs: { compare: async () => true, hash: async () => 'new-hash' } }));
  assert.equal((await route.PATCH(request('/api/settings/password', { currentPassword: 'OldPassword1', newPassword: 'NewPassword1', confirmPassword: 'NewPassword1' }, 'PATCH'))).status, 409);
});
