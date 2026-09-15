import { runDocumentParser } from "@/lib/documents/run-parser";
import type { GallupExcelParseResult } from "@/lib/excel/gallup-core";

export type { GallupExcelTheme, GallupExcelRow, GallupExcelParseResult } from "@/lib/excel/gallup-core";

export async function parseGallupExcel(buffer: Buffer): Promise<GallupExcelParseResult> {
  return runDocumentParser<GallupExcelParseResult>("excel", buffer);
}
