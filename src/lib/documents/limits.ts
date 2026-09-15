export const DOCUMENT_LIMITS = Object.freeze({
  inputBytes: 10 * 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
  textCharacters: 500_000,
  pdfPages: 100,
  spreadsheetRows: 1_020,
  spreadsheetColumns: 128,
  cellCharacters: 4_096,
  archiveBytes: 32 * 1024 * 1024,
  archiveEntries: 256,
  timeoutMs: 10_000,
  heapMb: 128,
  rssBytes: 256 * 1024 * 1024,
  concurrency: 2,
});

export type DocumentErrorCode = "LIMIT" | "BUSY" | "TIMEOUT" | "INVALID" | "UNAVAILABLE";

export class DocumentParseError extends Error {
  constructor(public readonly code: DocumentErrorCode, message: string) {
    super(message);
    this.name = "DocumentParseError";
  }
}
