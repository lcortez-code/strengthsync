const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./load-module.cjs");

test("multipart body limits apply to chunked requests and cancel before parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { cancelled = true; },
  });
  const { readUploadForm } = loadModule("src/lib/api/upload.ts");
  await assert.rejects(readUploadForm(new Request("http://localhost/upload", { method: "POST", body, duplex: "half" }), 10), /too large/);
  assert.equal(cancelled, true);
});

test("a normal multipart upload retains file contents", async () => {
  const form = new FormData();
  form.set("file", new Blob(["synthetic PDF"], { type: "application/pdf" }), "sample.pdf");
  const { readUploadForm } = loadModule("src/lib/api/upload.ts");
  const parsed = await readUploadForm(new Request("http://localhost/upload", { method: "POST", body: form }));
  assert.equal(await parsed.get("file").text(), "synthetic PDF");
});

test("CSV exports render formula prefixes as text and preserve quoted data", () => {
  const { csvCell } = loadModule("src/lib/api/csv.ts");
  for (const value of ["=SUM(1,2)", "+1", "-1", "@SUM(1,2)", "\t=1", "  =1", "\r=1"]) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('Normal, "Name"'), '"Normal, ""Name"""');
});

test("PDF assignment cannot attach another tenant's existing account or an unaccepted invitation", async () => {
  const form = new FormData();
  form.set("file", new Blob(["synthetic PDF"], { type: "application/pdf" }), "sample.pdf");
  form.set("forUserEmail", "existing@example.test");
  const { POST } = loadModule("src/app/api/strengths/upload/route.ts", {
    "next-auth": { getServerSession: async () => ({ user: { id: "admin", organizationId: "attacker-org", memberId: "admin-member", role: "OWNER" } }) },
    "@/lib/auth/config": { authOptions: {} },
    "@/lib/pdf/parser": { parseCliftonStrengthsPDF: async () => ({ themes: [], participantName: "Test" }), validateParsedReport: () => ({ valid: true }) },
    "@/lib/prisma": { prisma: { organizationMember: { findFirst: async ({ where }) => {
      assert.equal(where.organizationId, "attacker-org");
      assert.equal(where.status, "ACTIVE");
      assert.equal(where.user.email, "existing@example.test");
      return null;
    } } } },
  });
  const response = await POST(new Request("http://localhost/upload", { method: "POST", body: form }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /accept their invitation/);
});
