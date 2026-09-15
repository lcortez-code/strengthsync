const assert = require("node:assert/strict");
const test = require("node:test");
const { resolve } = require("node:path");
const childProcess = require("node:child_process");
const XLSX = require("xlsx");
const { loadModule } = require("./load-module.cjs");
const { pdfFixture } = require("./document-fixtures.cjs");
const { DOCUMENT_LIMITS, DocumentParseError } = loadModule("src/lib/documents/limits.ts");
const { THEMES } = loadModule("src/constants/strengths-data.ts");
const { parseCliftonStrengthsPDF } = loadModule("src/lib/pdf/parser.ts");
const { parseGallupExcel } = loadModule("src/lib/excel/gallup-parser.ts");

function workbook(bookType = "xlsx", change = () => {}) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Gallup Access export"],
    ["Name", "Email", ...THEMES.map((theme) => theme.name)],
    ["Test Person", "TEST@example.test", ...THEMES.map((_, i) => i + 1)],
  ]);
  change(sheet);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Strengths");
  return XLSX.write(book, { type: "buffer", bookType, compression: true });
}

function controlledRunner(mode, limits = {}) {
  return loadModule("src/lib/documents/run-parser.ts", {
    "@/lib/documents/limits": { DOCUMENT_LIMITS: { ...DOCUMENT_LIMITS, ...limits }, DocumentParseError },
    "node:child_process": { ...childProcess, spawn: (file, args, options) => childProcess.spawn(file, [...args.slice(0, 2), resolve(__dirname, "document-test-child.cjs"), mode], options) },
  }).runDocumentParser;
}

test("real PDF decoder preserves reports with plain and compressed page streams", async () => {
  for (const compressed of [false, true]) {
    const report = await parseCliftonStrengthsPDF(pdfFixture({ compressed }));
    assert.equal(report.participantName, "Test Person");
    assert.deepEqual(report.themes.map((theme) => theme.name), ["Achiever", "Strategic", "Learner", "Relator", "Analytical"]);
    assert.equal(report.reportType, "TOP_5");
    assert.ok(report.rawText.length <= 500);
  }
});

test("real PDF decoder rejects invalid, oversized and over-page-limit inputs", async () => {
  await assert.rejects(parseCliftonStrengthsPDF(Buffer.alloc(DOCUMENT_LIMITS.inputBytes + 1)), /10 MB/);
  await assert.rejects(parseCliftonStrengthsPDF(Buffer.from("not a PDF")), /Invalid PDF/);
  await assert.rejects(parseCliftonStrengthsPDF(pdfFixture({ pages: 101 })), /100 page/);
});

test("PDF page boundary and empty text preserve successful diagnostics", async () => {
  const boundary = await parseCliftonStrengthsPDF(pdfFixture({ pages: 100 }));
  assert.equal(boundary.themes.length, 5);
  const scanned = await parseCliftonStrengthsPDF(pdfFixture({ text: "" }));
  assert.equal(scanned.themes.length, 0);
  assert.equal(scanned.confidence, 0);
});

test("real Excel decoders preserve XLSX, legacy XLS and UTF16 XML exports", async () => {
  for (const format of ["xlsx", "biff8", "xlml"]) {
    let input = workbook(format);
    if (format === "xlml") input = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(input.toString("utf8"), "utf16le")]);
    const result = await parseGallupExcel(input);
    assert.deepEqual(result.errors, [], `${format}: ${result.errors}`);
    assert.equal(result.validRows, 1);
    assert.equal(result.rows[0].participantName, "Test Person");
    assert.equal(result.rows[0].participantEmail, "test@example.test");
    assert.equal(result.rows[0].themes.length, 34);
  }
});

test("Excel row, column and cell limits reject data before member iteration", async () => {
  for (const change of [
    (sheet) => { sheet.A1021 = { t: "s", v: "Too far" }; sheet["!ref"] = "A1:AJ1021"; },
    (sheet) => { sheet.DY1 = { t: "s", v: "Too wide" }; sheet["!ref"] = "A1:DY3"; },
    (sheet) => { sheet.A3 = { t: "s", v: "x".repeat(4097) }; },
  ]) await assert.rejects(parseGallupExcel(workbook("xlsx", change)), /limit/);
});

test("Excel rejects suffix-bearing ranks instead of silently coercing them", async () => {
  const parsed = await parseGallupExcel(workbook("xlsx", (sheet) => { sheet.C3 = { t: "s", v: "1junk" }; }));
  assert.equal(parsed.rows[0].themes.length, 33);
  assert.match(parsed.rows[0].warnings.join(" "), /Invalid rank/);
});

test("archive expansion checks reject dishonest compressed lengths and declared bombs", async () => {
  const { validateWorkbookArchive } = loadModule("src/lib/documents/archive.ts");
  const input = workbook();
  validateWorkbookArchive(input);
  const bad = Buffer.from(input);
  const central = bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bad.writeUInt32LE(40 * 1024 * 1024, central + 24);
  await assert.rejects(parseGallupExcel(bad), /invalid|limit/);
  const mismatched = Buffer.from(input);
  mismatched.writeUInt32LE(1, central + 20);
  await assert.rejects(parseGallupExcel(mismatched), /invalid|limit/);
});

test("parser deadline kills blocked CPU work without blocking the caller event loop", async () => {
  let responsive = false;
  const timer = setTimeout(() => { responsive = true; }, 20);
  await assert.rejects(controlledRunner("hang", { timeoutMs: 200 })("pdf", Buffer.from("test")), (error) => error.code === "TIMEOUT");
  clearTimeout(timer);
  assert.equal(responsive, true);
});

test("parser limits real child resident memory and output", async () => {
  await assert.rejects(controlledRunner("memory", { rssBytes: 64 * 1024 * 1024, timeoutMs: 3000 })("pdf", Buffer.from("test")), (error) => error.code === "LIMIT");
  await assert.rejects(controlledRunner("output", { outputBytes: 4096 })("pdf", Buffer.from("test")), (error) => error.code === "LIMIT");
});

test("parallel route bundles share admission and recover only after terminated children close", async () => {
  const first = controlledRunner("hang", { timeoutMs: 200 });
  const second = controlledRunner("hang", { timeoutMs: 200 });
  const jobs = [first("pdf", Buffer.from("test")), second("excel", Buffer.from("test"))];
  const done = Promise.allSettled(jobs);
  await assert.rejects(controlledRunner("environment")("pdf", Buffer.from("test")), (error) => error.code === "BUSY");
  assert.ok((await done).every((result) => result.status === "rejected" && result.reason.code === "TIMEOUT"));
  const result = await controlledRunner("environment")("pdf", Buffer.from("test"));
  // macOS may inject its own text-encoding metadata when loading native modules.
  delete result.env.__CF_USER_TEXT_ENCODING;
  assert.deepEqual(result.env, { NODE_ENV: "production", LANG: "en_US.UTF-8", TZ: "UTC" });
  assert.ok(result.execArgv.includes("--max-old-space-size=128"));
});
