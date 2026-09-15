const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequire } = require("node:module");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

test("UUID override preserves each Bot Framework and MSAL CommonJS consumer", async () => {
  for (const name of ["botbuilder", "botbuilder-core", "botframework-schema", "botframework-streaming", "@azure/msal-node"]) {
    const consumer = createRequire(require.resolve(name));
    const uuid = consumer("uuid");
    assert.equal(consumer("uuid/package.json").version, "11.1.1");
    assert.ok(uuid.validate(uuid.v4()), name);
    assert.throws(() => uuid.v5("fixture", uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
  }
  const { TestAdapter, MessageFactory } = require("botbuilder");
  const adapter = new TestAdapter(async (context) => context.sendActivity(MessageFactory.text(`Received ${context.activity.text}`)));
  await adapter.send("synthetic hello").assertReply("Received synthetic hello");
  const { CryptoProvider } = require("@azure/msal-node");
  assert.match(new CryptoProvider().createNewGuid(), /^[a-f0-9-]{36}$/);
  const { generateGuid } = require("botframework-streaming/lib/utilities/protocol-base");
  assert.match(generateGuid(), /^[a-f0-9-]{36}$/);
});

test("deepmerge override preserves nested Prisma config and safely handles recursive objects", async () => {
  const { deepmerge } = await import("deepmerge-ts");
  assert.deepEqual(deepmerge({ nested: { left: 1 }, list: [1] }, { nested: { right: 2 }, list: [2] }), { nested: { left: 1, right: 2 }, list: [1, 2] });
  const left = { value: 1 }; left.self = left;
  const right = { other: 2 }; right.self = right;
  const merged = deepmerge(left, right);
  assert.equal(merged.value, 1);
  assert.equal(merged.other, 2);
  assert.equal(merged.self, merged);
  const root = mkdtempSync(join(tmpdir(), "strengthsync-prisma-config-"));
  try {
    writeFileSync(join(root, "prisma.config.cjs"), 'module.exports = { schema: "custom/schema.prisma", migrations: { path: "custom/migrations" } };\n');
    const { loadConfigFromFile } = require("@prisma/config");
    const loaded = await loadConfigFromFile({ configRoot: root });
    assert.equal(loaded.error, undefined);
    assert.equal(loaded.config.schema, join(realpathSync(root), "custom/schema.prisma"));
    assert.equal(loaded.config.migrations.path, join(realpathSync(root), "custom/migrations"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Next resolves fixed PostCSS and retains CSS transforms while rejecting unsafe automatic map reads", async () => {
  const nextRequire = createRequire(require.resolve("next"));
  const postcss = nextRequire("postcss");
  assert.equal(nextRequire("postcss/package.json").version, "8.5.28");
  const result = await postcss([require("autoprefixer")]).process(".test { display: flex; user-select: none }", { from: undefined });
  assert.match(result.css, /user-select: none/);
  const root = mkdtempSync(join(tmpdir(), "strengthsync-postcss-map-"));
  try {
    mkdirSync(join(root, "styles"));
    const map = join(root, "outside.map");
    writeFileSync(map, JSON.stringify({ version: 3, sources: ["source.css"], sourcesContent: ["synthetic private map marker"], names: [], mappings: "" }));
    symlinkSync(map, join(root, "styles", "linked.map"));
    for (const [annotation, from] of [[map, undefined], ["../outside.map", join(root, "styles", "main.css")], ["linked.map", join(root, "styles", "main.css")]]) {
      const parsed = postcss.parse(`a { color: red } /*# sourceMappingURL=${annotation} */`, { from });
      assert.equal(parsed.source.input.map?.text, undefined);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
