const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./load-module.cjs");
const { credentialVersion } = loadModule("src/lib/auth/session-security.ts");

function fixture() {
  const membership = { id: "member-a", organizationId: "org-a", role: "ADMIN", organization: { name: "A" } };
  const user = { passwordHash: "synthetic-hash-a", avatarUrl: null, fullName: "Test", organizationMemberships: [membership] };
  const prisma = { user: { findUnique: async () => user } };
  const { authOptions } = loadModule("src/lib/auth/config.ts", { "@/lib/prisma": { prisma } });
  const token = { id: "user-a", memberId: "member-a", organizationId: "org-a", role: "ADMIN", credentialVersion: credentialVersion(user.passwordHash) };
  return { user, token, callbacks: authOptions.callbacks };
}

test("an existing session immediately adopts a demoted role and never exposes its credential binding", async () => {
  const { user, token, callbacks } = fixture();
  user.organizationMemberships[0].role = "MEMBER";
  const refreshed = await callbacks.jwt({ token });
  const session = await callbacks.session({ token: refreshed, session: { user: {} } });
  assert.equal(session.user.role, "MEMBER");
  assert.equal(session.user.memberId, "member-a");
  assert.equal(JSON.stringify(session).includes("credentialVersion"), false);
  assert.equal(JSON.stringify(session).includes("synthetic-hash"), false);
});

test("password change or reset revokes the previously issued session", async () => {
  const { user, token, callbacks } = fixture();
  user.passwordHash = "synthetic-replacement-hash";
  await assert.rejects(callbacks.jwt({ token }), /no longer valid/);
});

test("suspended and deleted memberships cannot retain access or silently change tenants", async () => {
  const { user, token, callbacks } = fixture();
  user.organizationMemberships = [];
  await assert.rejects(callbacks.jwt({ token }), /no longer active/);
});

test("legacy sessions without credential binding must authenticate again", async () => {
  const { token, callbacks } = fixture();
  delete token.credentialVersion;
  await assert.rejects(callbacks.jwt({ token }), /no longer valid/);
});

test("session refresh fails closed when the database cannot verify current permissions", async () => {
  const { authOptions } = loadModule("src/lib/auth/config.ts", {
    "@/lib/prisma": { prisma: { user: { findUnique: async () => { throw new Error("unavailable"); } } } },
  });
  await assert.rejects(authOptions.callbacks.jwt({ token: { id: "user-a" } }), /unavailable/);
});

test("organization switch uses only an active membership belonging to the authenticated user", async () => {
  let selectQuery;
  const { authOptions } = loadModule("src/lib/auth/config.ts", {
    "@/lib/prisma": { prisma: { user: { findUnique: async (query) => {
      selectQuery = query;
      return { passwordHash: "hash", avatarUrl: null, fullName: "User", organizationMemberships: query.select.organizationMemberships.where.organizationId === "joined-org"
        ? [{ id: "joined-member", organizationId: "joined-org", role: "MEMBER", organization: { name: "Joined" } }] : [] };
    } } } },
  });
  const original = { id: "user-a", memberId: "member-a", organizationId: "org-a", role: "OWNER", credentialVersion: credentialVersion("hash") };
  const token = await authOptions.callbacks.jwt({ token: { ...original }, trigger: "update", session: { organizationId: "joined-org", role: "OWNER", memberId: "forged" } });
  assert.equal(selectQuery.where.id, "user-a");
  assert.equal(selectQuery.select.organizationMemberships.where.status, "ACTIVE");
  assert.equal(token.memberId, "joined-member");
  assert.equal(token.role, "MEMBER");
  await assert.rejects(authOptions.callbacks.jwt({ token: original, trigger: "update", session: { organizationId: "foreign-org" } }), /no longer active/);
});

test('authentication logs omit provider metadata and arbitrary error strings', () => {
  const { authOptions } = loadModule('src/lib/auth/config.ts', { '@/lib/prisma': { prisma: {} } });
  const output=[];const oldError=console.error,oldWarn=console.warn;
  console.error=(...args)=>output.push(args);console.warn=(...args)=>output.push(args);
  try {
    authOptions.logger.error('JWT_SESSION_ERROR',{secret:'synthetic-private-payload'});
    authOptions.logger.error('provider response synthetic-private-payload',{token:'private'});
    authOptions.logger.warn('unsafe synthetic-private-payload');
    assert.doesNotMatch(JSON.stringify(output),/private|provider response/);
    assert.equal(output[0][1],'JWT_SESSION_ERROR');
  } finally {console.error=oldError;console.warn=oldWarn;}
});
