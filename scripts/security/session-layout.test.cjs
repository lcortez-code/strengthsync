const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { transformSync } = require("esbuild");

const app = resolve(__dirname, "../../src/app");
const protectedLayouts = [
  "admin/constants", "admin/dashboard", "admin/excel-import", "admin/import",
  "admin/members", "admin/review-cycles", "admin/upload", "cards", "challenges",
  "dashboard", "directory", "feed", "leaderboard", "marketplace", "mentorship",
  "notifications", "partnerships/guide", "partnerships/meeting", "reviews", "settings",
  "shoutouts", "strengths", "team",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function layoutHarness(path, session, platformAdmin = false) {
  const SessionProvider = () => null, DashboardLayout = () => null;
  const calls = [];
  const authOptions = { test: true };
  const mocks = {
    "next-auth": { getServerSession: async (options) => { calls.push(options); return session; } },
    "@/lib/auth/config": { authOptions },
    "next/navigation": { redirect: (target) => { throw new Error(`Redirect: ${target}`); } },
    "@/components/providers/SessionProvider": { SessionProvider },
    "@/components/providers/ThemeProvider": { ThemeProvider: () => null },
    "@/components/providers/BadgeCelebrationProvider": { BadgeCelebrationProvider: () => null },
    "@/components/layout/DashboardLayout": { DashboardLayout },
    "@/lib/auth/platform-admin": { isPlatformAdmin: () => platformAdmin },
    "./globals.css": {},
  };
  const { code } = transformSync(readFileSync(join(app, path), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic", target: "node20" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected layout dependency: ${name}`);
  }, module, module.exports);
  return { render: module.exports.default, SessionProvider, DashboardLayout, authOptions, calls };
}

test("app mounts exactly one session provider in its root layout", () => {
  const providers = sourceFiles(app).filter((path) => /\bSessionProvider\b/.test(readFileSync(path, "utf8")));
  assert.deepEqual(providers, [join(app, "layout.tsx")]);
  assert.equal(readFileSync(providers[0], "utf8").match(/<SessionProvider\b/g)?.length, 1);
});

test("root initializes the provider with the actual server session for signed-in and signed-out users", async () => {
  for (const session of [null, { user: { id: "owner", role: "OWNER" } }]) {
    const h = layoutHarness("layout.tsx", session);
    const html = await h.render({ children: "page content" });
    const provider = html.props.children.props.children;
    assert.equal(provider.type, h.SessionProvider);
    assert.equal(provider.props.session, session);
    assert.deepEqual(h.calls, [h.authOptions]);
    assert.equal(provider.props.children.props.children.props.children, "page content");
  }
});

test("all formerly nested protected layouts still enforce login and preserve their dashboard shell", async () => {
  for (const directory of protectedLayouts) {
    const denied = layoutHarness(`${directory}/layout.tsx`, null);
    await assert.rejects(denied.render({ children: "page content" }), /Redirect: \/auth\/login/, directory);
    assert.deepEqual(denied.calls, [denied.authOptions], directory);
    const allowed = layoutHarness(`${directory}/layout.tsx`, { user: { id: "owner", role: "OWNER" } }, true);
    const result = await allowed.render({ children: "page content" });
    assert.equal(result.type, allowed.DashboardLayout, directory);
    assert.equal(result.props.children, "page content", directory);
  }
});

test("existing role and platform-admin layout checks remain in force", async () => {
  const member = { user: { id: "member", role: "MEMBER" } };
  for (const directory of ["admin/import", "admin/constants"]) {
    const h = layoutHarness(`${directory}/layout.tsx`, member);
    await assert.rejects(h.render({ children: "restricted content" }), /Redirect: \/dashboard/);
  }
});
