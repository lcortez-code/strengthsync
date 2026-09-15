import { runDocumentParser } from "@/lib/documents/run-parser";
import type { ParsedStrengthsReport } from "@/lib/pdf/report";

export type { StrengthBlend, ApplySection, ParsedTheme, ParsedStrengthsReport } from "@/lib/pdf/report";
export { parseStrengthsFromText, validateParsedReport } from "@/lib/pdf/report";

export async function parseCliftonStrengthsPDF(buffer: Buffer): Promise<ParsedStrengthsReport> {
  return runDocumentParser<ParsedStrengthsReport>("pdf", buffer);
}
