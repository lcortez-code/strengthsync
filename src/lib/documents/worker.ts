import { PDFParse } from "pdf-parse";
import { parseStrengthsFromText } from "@/lib/pdf/report";
import { parseGallupExcel } from "@/lib/excel/gallup-core";
import { DOCUMENT_LIMITS, DocumentParseError } from "@/lib/documents/limits";
import { validateWorkbookArchive } from "@/lib/documents/archive";

async function parsePdf(buffer: Buffer) {
  if (!buffer.subarray(0, 1_024).includes(Buffer.from("%PDF-"))) throw new DocumentParseError("INVALID", "Invalid PDF document");
  const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  try {
    const info = await parser.getInfo();
    if (info.total > DOCUMENT_LIMITS.pdfPages) throw new DocumentParseError("LIMIT", "PDF exceeds the 100 page limit");
    let text = "";
    for (let page = 1; page <= info.total; page++) {
      const result = await parser.getText({ partial: [page], pageJoiner: "" });
      if (text.length + result.text.length + 2 > DOCUMENT_LIMITS.textCharacters) throw new DocumentParseError("LIMIT", "PDF text exceeds the import limit");
      text += `\n\n${result.text}`;
    }
    return { ...parseStrengthsFromText(text), rawText: text.substring(0, 500) };
  } finally {
    await parser.destroy();
  }
}

async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > DOCUMENT_LIMITS.inputBytes) throw new DocumentParseError("LIMIT", "Document exceeds the 10 MB limit");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length < 4) throw new DocumentParseError("INVALID", "Document does not contain valid data");
  let result;
  if (process.argv[2] === "pdf") result = await parsePdf(buffer);
  else if (process.argv[2] === "excel") {
    validateWorkbookArchive(buffer);
    result = parseGallupExcel(buffer);
  } else throw new DocumentParseError("INVALID", "Unsupported document type");
  const output = JSON.stringify({ ok: true, result });
  if (Buffer.byteLength(output) > DOCUMENT_LIMITS.outputBytes) throw new DocumentParseError("LIMIT", "Document extracted data exceeds the import limit");
  process.stdout.write(output);
}

main().catch((error: unknown) => {
  const safe = error instanceof DocumentParseError ? error : new DocumentParseError("INVALID", "Document is invalid or could not be processed");
  process.stdout.write(JSON.stringify({ ok: false, code: safe.code, message: safe.message }));
});
