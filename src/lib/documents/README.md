# Isolated document imports

PDF upload, bulk member PDF attachment, and Gallup Excel import call `runDocumentParser`. It executes both binary decoding and report interpretation in a disposable child process. No request-supplied path, executable, parser options, or URL is used. The child receives the document through stdin and returns bounded JSON; application credentials and inherited Node options are excluded from its environment.

`npm run dev` and `npm run build` generate `.document-worker/parser.cjs` from `worker.ts`. The bundle includes the spreadsheet parser and report rules. PDF parsing uses `pdf-parse` 2 and its maintained PDF.js distribution, with JavaScript evaluation disabled. Next file tracing must include the bundle and PDF/native dependencies so the same worker runs from standalone output.

## Limits

- 10 MB input and 4 MB output; two active children per application process. Excess work is rejected immediately without an unbounded queue.
- Ten-second wall deadline; 128 MB V8 old heap and 8 MB young heap. A separate 250 ms monitor kills children above 256 MB resident memory. Resident memory can briefly exceed the threshold between samples; this is resource containment, not an operating-system security sandbox or a hard host-wide memory cap.
- 100 PDF pages, checked before text extraction; 500,000 extracted characters. Reports return at most 500 raw diagnostic characters.
- First Excel sheet only, at most 1,020 rows (including headers), 128 columns, 4,096 characters per cell, and 500,000 total characters. Original dimensions are checked so truncated/sparse worksheets are rejected rather than partly imported.
- ZIP workbooks allow 256 entries and 32 MB total actual expansion. Declared and actual sizes are checked with bounded decompression. Legacy XLS and UTF16 XML exports run under the same process bounds.

Linux memory inspection reads `/proc/<pid>/status`; macOS uses `/bin/ps`. Unsupported or restricted memory inspection fails closed. Failed, timed-out, and excessive-output children retain their concurrency slot until they have exited.

## Verification

Run `npm run build:document-worker`, then `node --test scripts/security/documents.test.cjs scripts/security/dependencies.test.cjs`. Tests use valid generated PDF/XLSX/XLS/XML files with synthetic data and real isolated child processes. Restricted macOS environments can block `ps`; these tests require permission to inspect their own child processes. No provider or database connection is made.

Dependency overrides are intentionally narrow: fixed PostCSS inside Next, deepmerge-ts inside Prisma config, and the last patched CommonJS UUID major for Bot Framework/MSAL. Compatibility tests exercise CSS transformation/map containment, Prisma config loading/recursive merging, and Bot Framework/MSAL UUID consumers. Recheck these overrides when upgrading their parents; do not remove them solely because an upstream version range still asks for an older release.
