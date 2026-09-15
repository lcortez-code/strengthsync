const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./load-module.cjs");

test("new tenant OWNER cannot access shared configuration, while an explicit platform user can", async () => {
  const previous = process.env.STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS;
  process.env.STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS = "operator-id";
  try {
    let userId = "self-registered-owner";
    let reads = 0;
    const routes = loadModule("src/app/api/admin/ai/prompts/route.ts", {
      "next-auth": { getServerSession: async () => ({ user: { id: userId, role: "OWNER" } }) },
      "@/lib/auth/config": { authOptions: {} },
      "@/lib/prisma": { prisma: { aIPromptTemplate: { findMany: async () => { reads++; return []; } } } },
    });
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      assert.equal((await routes[method](new Request("http://localhost/api/admin/ai/prompts"))).status, 403);
    }
    assert.equal(reads, 0);
    userId = "operator-id";
    assert.equal((await routes.GET(new Request("http://localhost/api/admin/ai/prompts"))).status, 200);
    assert.equal(reads, 1);
  } finally {
    if (previous === undefined) delete process.env.STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS;
    else process.env.STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS = previous;
  }
});

test("organization settings response never fetches or returns provider credentials", async () => {
  const { GET } = loadModule("src/app/api/settings/organization/route.ts", {
    "next-auth": { getServerSession: async () => ({ user: { id: "u", organizationId: "o", role: "MEMBER" } }) },
    "@/lib/auth/config": { authOptions: {} },
    "@/lib/prisma": { prisma: { organization: { findUnique: async ({ select }) => {
      assert.equal(select.settings, undefined);
      return { id: "o", name: "Org", inviteCode: "private-code", _count: { members: 2 } };
    } } } },
  });
  const body = await (await GET()).json();
  assert.equal(body.data.inviteCode, null);
  assert.equal(body.data.settings, undefined);
});

test("Teams destination validation rejects internal targets, deceptive hosts and credential-bearing URLs", () => {
  const { isTeamsWebhookUrl } = loadModule("src/lib/integrations/teams-url.ts");
  for (const url of ["https://127.0.0.1/x", "https://[::1]/x", "http://outlook.office.com/x", "https://outlook.office.com.evil.test/x", "https://a.webhook.office.com@evil.test/x", "https://user:pass@a.webhook.office.com/x", "https://a.logic.azure.com:8443/x", "https://arbitrary.example/x"]) {
    assert.equal(isTeamsWebhookUrl(url), false);
  }
  for (const url of ["https://outlook.office.com/webhook/test", "https://tenant.webhook.office.com/webhookb2/test", "https://prod-01.westus.logic.azure.com/workflows/test", "https://tenant.environment.api.powerplatform.com/powerautomate/test"]) {
    assert.equal(isTeamsWebhookUrl(url), true);
  }
});

test("Teams sends enforce destination checks and disallow redirects without contacting the network", async () => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
  try {
    const { sendTestCard } = loadModule("src/lib/integrations/teams-webhook.ts", { "@/lib/prisma": { prisma: {} } });
    assert.equal(await sendTestCard("https://127.0.0.1/private"), false);
    assert.equal(calls.length, 0);
    assert.equal(await sendTestCard("https://tenant.webhook.office.com/webhookb2/test"), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, "error");
    assert.ok(calls[0].options.signal instanceof AbortSignal);
  } finally { global.fetch = previousFetch; }
});

test("a global Teams webhook is available only to its explicitly bound organization", () => {
  const previousUrl = process.env.TEAMS_WEBHOOK_URL;
  const previousOrg = process.env.TEAMS_WEBHOOK_ORGANIZATION_ID;
  process.env.TEAMS_WEBHOOK_URL = "https://tenant.webhook.office.com/webhookb2/test";
  process.env.TEAMS_WEBHOOK_ORGANIZATION_ID = "intended-org";
  try {
    const { getTeamsFallbackUrl } = loadModule("src/lib/integrations/teams-url.ts");
    assert.equal(getTeamsFallbackUrl("foreign-org"), null);
    assert.ok(getTeamsFallbackUrl("intended-org"));
    delete process.env.TEAMS_WEBHOOK_ORGANIZATION_ID;
    assert.equal(getTeamsFallbackUrl("intended-org"), null);
  } finally {
    if (previousUrl === undefined) delete process.env.TEAMS_WEBHOOK_URL; else process.env.TEAMS_WEBHOOK_URL = previousUrl;
    if (previousOrg === undefined) delete process.env.TEAMS_WEBHOOK_ORGANIZATION_ID; else process.env.TEAMS_WEBHOOK_ORGANIZATION_ID = previousOrg;
  }
});
