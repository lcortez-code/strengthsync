const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module.cjs");

const { generateWeeklyDigestHtml, generateWeeklyDigestText } = loadModule("src/lib/email/templates/weekly-digest.ts");
const { safeEmailUrl } = loadModule("src/lib/email/html.ts");

function digest() {
  return {
    userName: "Alex Example", userEmail: "alex@example.test", organizationName: "Team A",
    periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-07"),
    shoutoutsReceived: [{ id: "s1", giverName: "Pat", giverAvatarUrl: "https://images.example.test/avatar.png", themeName: "Learner", domainSlug: "strategic", message: "Helpful work", createdAt: "2026-09-03" }],
    shoutoutsGiven: 1, pointsEarned: 2, totalPoints: 1000, currentStreak: 3,
    badgesEarned: [{ name: "Helper", description: "Helped a teammate", iconUrl: "/badges/helper.svg", earnedAt: "2026-09-03" }],
    badgeProgress: { badgeName: "Contributor", current: 1, required: 3 },
    activeChallenges: [{ name: "Weekly challenge", type: "CUSTOM", progress: 50, endsAt: "Sep 10" }],
    userRank: 1, topContributors: [{ name: "Alex Example", points: 1000, rank: 1 }],
    suggestedActions: ["Thank a teammate"], aiNarrative: "Keep learning.",
    appUrl: "https://app.example.test", unsubscribeUrl: "https://app.example.test/settings/notifications?unsubscribe=weekly&from=email",
  };
}

const textFields = [
  ["userName", (d, value) => d.userName = value],
  ["organizationName", (d, value) => d.organizationName = value],
  ["giverName", (d, value) => d.shoutoutsReceived[0].giverName = value],
  ["themeName", (d, value) => d.shoutoutsReceived[0].themeName = value],
  ["message", (d, value) => d.shoutoutsReceived[0].message = value],
  ["badge name", (d, value) => d.badgesEarned[0].name = value],
  ["badge description", (d, value) => d.badgesEarned[0].description = value],
  ["progress name", (d, value) => d.badgeProgress.badgeName = value],
  ["challenge name", (d, value) => d.activeChallenges[0].name = value],
  ["challenge end date", (d, value) => d.activeChallenges[0].endsAt = value],
  ["contributor name", (d, value) => d.topContributors[0].name = value],
  ["suggested action", (d, value) => d.suggestedActions[0] = value],
  ["AI narrative", (d, value) => d.aiNarrative = value],
];

for (const [name, assign] of textFields) {
  test(`digest displays ${name} as text instead of HTML`, () => {
    const data = digest();
    assign(data, '<script>probe("x")</script>');
    const html = generateWeeklyDigestHtml(data);
    assert.doesNotMatch(html, /<script|<\/script/i);
    assert.ok(html.includes("&lt;script&gt;probe(&quot;x&quot;)&lt;/script&gt;"));
  });
}

test("image attributes escape quotes and ordinary content remains readable", () => {
  const data = digest();
  data.shoutoutsReceived[0].giverName = 'Pat" onerror="probe()';
  const html = generateWeeklyDigestHtml(data);
  assert.ok(html.includes('alt="Pat&quot; onerror=&quot;probe()"'));
  assert.ok(html.includes('src="https://app.example.test/badges/helper.svg"'));
  assert.ok(html.includes("unsubscribe=weekly&amp;from=email"));
  assert.ok(html.includes(">1,000</td>"));
});

test("rejects executable schemes and credential-bearing URLs in links and images", () => {
  for (const url of ["javascript:probe()", "jAvAsCrIpT:probe()", "data:text/html,<script>probe()</script>", "file:///tmp/image", "https://user:password@example.test/"]) {
    assert.equal(safeEmailUrl(url, "https://app.example.test"), "");
    const data = digest();
    data.appUrl = url;
    data.unsubscribeUrl = url;
    data.shoutoutsReceived[0].giverAvatarUrl = url;
    data.badgesEarned[0].iconUrl = url;
    const html = generateWeeklyDigestHtml(data);
    assert.doesNotMatch(html, /(?:src|href)="(?:javascript:|data:|file:|https:\/\/user:)/i);
    assert.ok(html.includes('href="https://strengthsync.app"'));
    assert.ok(!generateWeeklyDigestText(data).includes(url));
  }
});

test("progress styles are finite and bounded even when stored progress is malformed", () => {
  for (const progress of [-20, 150, NaN, '1%;background:url(javascript:probe())']) {
    const data = digest();
    data.activeChallenges[0].progress = progress;
    const html = generateWeeklyDigestHtml(data);
    const expected = progress === 150 ? 100 : 0;
    assert.ok(html.includes(`width: ${expected}%; transition:`));
    assert.doesNotMatch(html, /width: [^"\n]*javascript/);
  }
});

test("plain text digest keeps user text without HTML entity double-encoding", () => {
  const data = digest();
  data.shoutoutsReceived[0].message = "Research & development <milestone>";
  assert.ok(generateWeeklyDigestText(data).includes("Research & development <milestone>"));
  assert.ok(generateWeeklyDigestHtml(data).includes("Research &amp; development &lt;milestone&gt;"));
});
