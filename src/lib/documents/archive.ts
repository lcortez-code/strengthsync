import { inflateRawSync } from "node:zlib";
import { DOCUMENT_LIMITS, DocumentParseError } from "@/lib/documents/limits";

// Validate actual expansion before SheetJS reads ZIP workbooks. All checks run in
// the isolated process, including CFB/legacy XML parsing outside this ZIP path.
export function validateWorkbookArchive(buffer: Buffer): void {
  if (buffer.readUInt32LE(0) !== 0x04034b50) return;
  const invalid = () => new DocumentParseError("INVALID", "Excel archive is invalid or uses an unsupported ZIP format");
  let end = buffer.length - 22;
  const start = Math.max(0, end - 65_535);
  for (; end >= start; end--) {
    if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break;
  }
  if (end < start) throw invalid();
  const entries = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const directoryEnd = cursor + buffer.readUInt32LE(end + 12);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || entries !== buffer.readUInt16LE(end + 8) || directoryEnd !== end) throw invalid();
  if (entries > DOCUMENT_LIMITS.archiveEntries) throw new DocumentParseError("LIMIT", "Excel contains too many archive entries");
  let expanded = 0;
  const names = new Set<string>();
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > directoryEnd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const expandedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const recordEnd = cursor + 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    if (flags & 1 || ![0, 8].includes(method) || recordEnd > directoryEnd || local + 30 > cursor || buffer.readUInt32LE(local) !== 0x04034b50) throw invalid();
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString("hex");
    if (names.has(name)) throw invalid();
    names.add(name);
    if (buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 26) !== nameLength || !buffer.subarray(local + 30, local + 30 + nameLength).equals(nameBytes)) throw invalid();
    const dataStart = local + 30 + nameLength + buffer.readUInt16LE(local + 28);
    if (dataStart + compressedSize > buffer.readUInt32LE(end + 16)) throw invalid();
    if (!(flags & 8) && (buffer.readUInt32LE(local + 18) !== compressedSize || buffer.readUInt32LE(local + 22) !== expandedSize)) throw invalid();
    if (expandedSize > DOCUMENT_LIMITS.archiveBytes - expanded) throw new DocumentParseError("LIMIT", "Excel archive expands beyond the 32 MB limit");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let actual: Buffer;
    try {
      actual = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, DOCUMENT_LIMITS.archiveBytes - expanded) });
    } catch {
      throw new DocumentParseError("LIMIT", "Excel archive is invalid or expands beyond the 32 MB limit");
    }
    if (actual.length !== expandedSize) throw invalid();
    expanded += actual.length;
    cursor = recordEnd;
  }
  if (cursor !== directoryEnd) throw invalid();
}
