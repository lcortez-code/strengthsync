import pdfParse from "pdf-parse";
import { ALL_THEME_NAMES, THEMES, DOMAINS, getDomainForTheme } from "@/constants/strengths-data";

// NEW: Strength blend interface - how this strength pairs with another Top 5 theme
export interface StrengthBlend {
  pairedTheme: string;      // e.g., "Strategic"
  pairedThemeSlug: string;  // e.g., "strategic"
  description: string;      // The description of how they blend together
}

// NEW: Apply section with tagline and action items from "Apply Your [Strength] to Succeed"
export interface ApplySection {
  tagline: string;           // The motivational tagline/quote
  actionItems: string[];     // 2 action items for applying the strength
}

export interface ParsedTheme {
  name: string;
  slug: string;
  domain: string;
  rank: number;
  personalizedDescription?: string;
  // NEW: Array of personalized insight paragraphs from "Why Your [Strength] Is Unique"
  personalizedInsights?: string[];
  // NEW: How this strength blends with other Top 5 themes
  strengthBlends?: StrengthBlend[];
  // NEW: Apply section with tagline and action items
  applySection?: ApplySection;
}

export interface ParsedStrengthsReport {
  participantName: string | null;
  themes: ParsedTheme[];
  reportType: "TOP_5" | "TOP_10" | "ALL_34";
  confidence: number;
  rawText?: string;
}

// Normalize theme names for matching
function normalizeThemeName(name: string): string {
  return name
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .replace(/-/g, " ")
    .trim()
    .toLowerCase();
}

// Create lookup map for themes
const THEME_LOOKUP = new Map<string, (typeof THEMES)[0]>();
for (const theme of THEMES) {
  THEME_LOOKUP.set(normalizeThemeName(theme.name), theme);
  // Also add variations
  THEME_LOOKUP.set(theme.name.toLowerCase(), theme);
  THEME_LOOKUP.set(theme.slug, theme);
}

// Try to find a valid theme from text
function findTheme(text: string): (typeof THEMES)[0] | null {
  const normalized = normalizeThemeName(text);
  return THEME_LOOKUP.get(normalized) || null;
}

// Extract participant name from common patterns
function extractParticipantName(text: string): string | null {
  // Common patterns in CliftonStrengths reports
  const patterns = [
    // "Your Signature Themes\nJohn Doe" or similar
    /Your (?:Signature|Top) (?:Themes?|Strengths?)\s*[\n\r]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    // "Signature Themes Report\nJohn Doe"
    /(?:Signature|Top) (?:Themes?|Strengths?) Report\s*[\n\r]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    // "CliftonStrengths 34\nJohn Doe"
    /CliftonStrengths\s*(?:34|for)?\s*[\n\r]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    // Name at the very beginning followed by date or report info
    /^([A-Z][a-z]+ [A-Z][a-z]+)\s*[\n\r]/m,
    // "Prepared for John Doe"
    /Prepared for[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    // "Report for: John Doe"
    /Report (?:for|to)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Validate it looks like a name (not a theme name)
      if (!findTheme(name) && name.length > 3 && name.length < 50) {
        return name;
      }
    }
  }

  return null;
}

// Extract themes in order of appearance
function extractThemes(text: string): ParsedTheme[] {
  const themes: ParsedTheme[] = [];
  const seenThemes = new Set<string>();

  // Create regex pattern to match all theme names
  const themeNames = ALL_THEME_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const themePattern = new RegExp(`\\b(${themeNames.join("|")})\\b`, "gi");

  // Find all theme mentions
  let match;
  while ((match = themePattern.exec(text)) !== null) {
    const matchedText = match[1];
    const theme = findTheme(matchedText);

    if (theme && !seenThemes.has(theme.slug)) {
      seenThemes.add(theme.slug);
      const domain = getDomainForTheme(theme.slug);

      // Extract all personalized content for this theme
      const personalizedDescription = extractDescriptionForTheme(text, theme.name, match.index);
      const personalizedInsights = extractPersonalizedInsights(text, theme.name, match.index);
      const strengthBlends = extractStrengthBlends(text, theme.name, match.index);
      const applySection = extractApplySection(text, theme.name, match.index);

      themes.push({
        name: theme.name,
        slug: theme.slug,
        domain: domain?.slug || "executing",
        rank: themes.length + 1,
        personalizedDescription,
        personalizedInsights: personalizedInsights.length > 0 ? personalizedInsights : undefined,
        strengthBlends: strengthBlends.length > 0 ? strengthBlends : undefined,
        applySection,
      });
    }
  }

  return themes;
}

// Try to extract personalized description for a theme
function extractDescriptionForTheme(text: string, themeName: string, startIndex: number): string | undefined {
  // Look for text following the theme name (up to 1500 chars to capture full description)
  const afterTheme = text.substring(startIndex + themeName.length, startIndex + themeName.length + 1500);

  // Find where the next theme starts (pattern: number followed by period and theme name, or just theme name)
  // Examples: "2. Relator", "3. Futuristic ®", or just a standalone theme name at line start
  const nextThemePatterns = [
    /\n\s*\d+\.\s*[A-Z][a-z]+\s*®?/,  // "2. Relator ®" pattern
    /\n\s*[A-Z][a-z]+\s*®?\s*\n/,      // Theme name on its own line
  ];

  let nextThemeIndex = afterTheme.length;
  for (const pattern of nextThemePatterns) {
    const match = afterTheme.match(pattern);
    if (match && match.index !== undefined && match.index < nextThemeIndex) {
      // Verify this is actually a theme name
      const potentialTheme = match[0].replace(/[\d.\s®\n]/g, '').trim();
      if (findTheme(potentialTheme)) {
        nextThemeIndex = match.index;
      }
    }
  }

  // Also check for any theme name that appears - cut off before it
  const themeNames = ALL_THEME_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const anyThemePattern = new RegExp(`\\n\\s*\\d+\\.\\s*(${themeNames.join("|")})\\s*®?`, "i");
  const anyThemeMatch = afterTheme.match(anyThemePattern);
  if (anyThemeMatch && anyThemeMatch.index !== undefined && anyThemeMatch.index < nextThemeIndex) {
    nextThemeIndex = anyThemeMatch.index;
  }

  // Stop at document footer/legend sections (domain descriptions at bottom of page)
  // Build domain patterns dynamically from constants to handle future changes
  const domainPatterns = DOMAINS.map(domain => {
    const escapedName = domain.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\n\\s*${escapedName}\\s+themes\\s+help`, "i");
  });

  const staticFooterPatterns = [
    /\n\s*CliftonStrengths\s*®?\s*(Top|for|34|Results)/i,
    /\n\s*Copyright\s+/i,
    /\n\s*Gallup\s*,?\s*Inc/i,
    /\n\s*This\s+report\s+presents/i,
    /\n\s*All\s+\d+\s+of\s+your\s+CliftonStrengths/i,
    /\n\s*Learn\s+more\s+about/i,
  ];

  const footerPatterns = [...domainPatterns, ...staticFooterPatterns];

  for (const pattern of footerPatterns) {
    const match = afterTheme.match(pattern);
    if (match && match.index !== undefined && match.index < nextThemeIndex) {
      nextThemeIndex = match.index;
    }
  }

  // Extract only the text before the next theme or footer
  const relevantText = afterTheme.substring(0, nextThemeIndex);

  // Find the personalized description - usually after the generic theme description
  // Look for patterns like "You..." which typically start personalized insights
  const personalizedMatch = relevantText.match(/[\n\r]+\s*(You[^.!?]*[.!?](?:\s*[^.!?]*[.!?]){0,4})/);

  if (personalizedMatch && personalizedMatch[1]) {
    let description = personalizedMatch[1].trim();

    // Clean up any trailing theme references that might have slipped through
    // Remove patterns like "2. Relator ®" or "3. Futuristic" at the end
    description = description.replace(/\s*\d+\.\s*[A-Z][a-z]+\s*®?\s*$/, '').trim();

    // Also remove if it ends with just a theme name
    for (const name of ALL_THEME_NAMES) {
      const endPattern = new RegExp(`\\s*\\d*\\.?\\s*${name}\\s*®?\\s*$`, 'i');
      description = description.replace(endPattern, '').trim();
    }

    // Remove any footer text that might have slipped through (using domain names from constants)
    const domainNamesPattern = DOMAINS.map(d => d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    description = description.replace(new RegExp(`\\s*(${domainNamesPattern})\\s+themes\\s+help.*$`, 'is'), '').trim();
    description = description.replace(new RegExp('\\s*CliftonStrengths\\s*®?.*$', 'is'), '').trim();

    // Only return if it looks like a real description
    if (description.length > 30 && description.length < 600) {
      return description;
    }
  }

  return undefined;
}

// NEW: Extract all personalized insights from "Why Your [Strength] Is Unique" section
function extractPersonalizedInsights(text: string, themeName: string, startIndex: number): string[] {
  const insights: string[] = [];

  // Look for text after the theme name, up to a reasonable limit
  const afterTheme = text.substring(startIndex, startIndex + 8000);

  // Look for the "Why Your [Theme] Is Unique" section header
  // Pattern variations: "WHY YOUR ACHIEVER IS UNIQUE", "Why Your Achiever Is Unique", etc.
  const escapedTheme = themeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionHeaderPattern = new RegExp(`why\\s+your\\s+${escapedTheme}\\s+is\\s+unique`, "i");
  const sectionMatch = afterTheme.match(sectionHeaderPattern);

  if (!sectionMatch || sectionMatch.index === undefined) {
    return insights;
  }

  // Get text after the header
  const afterHeader = afterTheme.substring(sectionMatch.index + sectionMatch[0].length);

  // Find the end of the insights section - typically ends at the next major section
  // Look for "How [Theme] Blends" or "Apply Your [Theme]" or the next theme number
  const sectionEndPatterns = [
    new RegExp(`how\\s+${escapedTheme}\\s+blends`, "i"),
    new RegExp(`apply\\s+your\\s+${escapedTheme}`, "i"),
    /\n\s*\d+\.\s*[A-Z][a-z]+\s*®?\s*\n/,  // Next theme pattern
    /CliftonStrengths®?\s*for/i,
    /Copyright\s+/i,
  ];

  let sectionEndIndex = afterHeader.length;
  for (const pattern of sectionEndPatterns) {
    const match = afterHeader.match(pattern);
    if (match && match.index !== undefined && match.index < sectionEndIndex) {
      sectionEndIndex = match.index;
    }
  }

  const insightsText = afterHeader.substring(0, sectionEndIndex);

  // Extract paragraphs that start with common Gallup insight starters
  // These typically start with: "Driven by your talents", "By nature", "Instinctively",
  // "Chances are good", "It's very likely", "Because of your strengths"
  const insightPatterns = [
    /Driven by your talents[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*/gi,
    /By nature[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*/gi,
    /Instinctively[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*/gi,
    /Chances are good[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*/gi,
    /It's very likely[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*/gi,
    /Because of your strengths[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*/gi,
  ];

  for (const pattern of insightPatterns) {
    const matches = insightsText.matchAll(pattern);
    for (const match of matches) {
      let insight = match[0].trim();
      // Clean up and validate
      if (insight.length > 30 && insight.length < 800) {
        // Remove trailing whitespace and newlines
        insight = insight.replace(/\s+/g, ' ').trim();
        if (!insights.includes(insight)) {
          insights.push(insight);
        }
      }
    }
  }

  // Also try to extract paragraph-style insights (sentences starting after a newline)
  // These capture paragraphs that might start differently
  const paragraphPattern = /\n\s*([A-Z][^.!?]*(?:you|your|yourself)[^.!?]*[.!?](?:\s*[^.!?]*[.!?])*)/gi;
  const paragraphs = insightsText.matchAll(paragraphPattern);
  for (const match of paragraphs) {
    let insight = match[1].trim();
    if (insight.length > 50 && insight.length < 800) {
      insight = insight.replace(/\s+/g, ' ').trim();
      if (!insights.includes(insight)) {
        insights.push(insight);
      }
    }
  }

  // Limit to ~5 insights and sort by appearance order
  return insights.slice(0, 5);
}

// NEW: Extract strength blend pairings from "How [Theme] Blends With Your Other Top Five"
function extractStrengthBlends(text: string, themeName: string, startIndex: number): StrengthBlend[] {
  const blends: StrengthBlend[] = [];

  const afterTheme = text.substring(startIndex, startIndex + 10000);

  // Look for the blends section header
  // Pattern: "HOW ACHIEVER BLENDS WITH YOUR OTHER TOP FIVE" or similar
  const escapedTheme = themeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blendsHeaderPattern = new RegExp(`how\\s+${escapedTheme}\\s+blends\\s+with\\s+your\\s+other\\s+top\\s+five`, "i");
  const headerMatch = afterTheme.match(blendsHeaderPattern);

  if (!headerMatch || headerMatch.index === undefined) {
    return blends;
  }

  // Get text after the header
  const afterHeader = afterTheme.substring(headerMatch.index + headerMatch[0].length);

  // Find the end of the blends section
  const sectionEndPatterns = [
    new RegExp(`apply\\s+your\\s+${escapedTheme}`, "i"),
    /\n\s*\d+\.\s*[A-Z][a-z]+\s*®?\s*\n/,  // Next theme pattern
    /CliftonStrengths®?\s*for/i,
    /why\s+your\s+\w+\s+is\s+unique/i,  // Next theme's unique section
  ];

  let sectionEndIndex = Math.min(afterHeader.length, 3000);
  for (const pattern of sectionEndPatterns) {
    const match = afterHeader.match(pattern);
    if (match && match.index !== undefined && match.index < sectionEndIndex) {
      sectionEndIndex = match.index;
    }
  }

  const blendsText = afterHeader.substring(0, sectionEndIndex);

  // Pattern to match blend pairings: "ACHIEVER + STRATEGIC" followed by description
  // The format is typically: THEME1 + THEME2 followed by a paragraph
  const themeNames = ALL_THEME_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const blendPattern = new RegExp(
    `(${themeNames.join("|")})\\s*\\+\\s*(${themeNames.join("|")})\\s*([^+]+?)(?=(?:${themeNames.join("|")})\\s*\\+|$)`,
    "gi"
  );

  const matches = blendsText.matchAll(blendPattern);
  for (const match of matches) {
    const theme1 = match[1].trim();
    const theme2 = match[2].trim();
    let description = match[3].trim();

    // Clean up description
    description = description.replace(/\s+/g, ' ').trim();

    // Determine which is the paired theme (not the current theme)
    const pairedThemeName = theme1.toLowerCase() === themeName.toLowerCase() ? theme2 : theme1;
    const pairedTheme = findTheme(pairedThemeName);

    if (pairedTheme && description.length > 20 && description.length < 600) {
      blends.push({
        pairedTheme: pairedTheme.name,
        pairedThemeSlug: pairedTheme.slug,
        description,
      });
    }
  }

  return blends.slice(0, 4);  // Typically 4 blends (with the other Top 5)
}

// NEW: Extract apply section from "Apply Your [Theme] to Succeed"
function extractApplySection(text: string, themeName: string, startIndex: number): ApplySection | undefined {
  const afterTheme = text.substring(startIndex, startIndex + 10000);

  // Look for the apply section header
  const escapedTheme = themeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const applyHeaderPattern = new RegExp(`apply\\s+your\\s+${escapedTheme}\\s+to\\s+succeed`, "i");
  const headerMatch = afterTheme.match(applyHeaderPattern);

  if (!headerMatch || headerMatch.index === undefined) {
    return undefined;
  }

  // Get text after the header
  const afterHeader = afterTheme.substring(headerMatch.index + headerMatch[0].length);

  // Find the end of the apply section
  const sectionEndPatterns = [
    /\n\s*\d+\.\s*[A-Z][a-z]+\s*®?\s*\n/,  // Next theme pattern
    /CliftonStrengths®?\s*for/i,
    /why\s+your\s+\w+\s+is\s+unique/i,
    /how\s+\w+\s+blends/i,
    /Copyright\s+/i,
  ];

  let sectionEndIndex = Math.min(afterHeader.length, 2000);
  for (const pattern of sectionEndPatterns) {
    const match = afterHeader.match(pattern);
    if (match && match.index !== undefined && match.index < sectionEndIndex) {
      sectionEndIndex = match.index;
    }
  }

  const applyText = afterHeader.substring(0, sectionEndIndex);

  // Extract tagline - usually in quotes or emphasized at the start
  // Patterns: "Tagline text here." or *Tagline text here.*
  let tagline = "";
  const taglinePatterns = [
    /"([^"]+)"/,                          // Quoted text
    /'([^']+)'/,                          // Single quoted text
    /[""]([^""]+)[""]/,                   // Smart quotes
    /\n\s*\*([^*]+)\*\s*\n/,             // Asterisk emphasized
    /\n\s*([A-Z][^.!?]{20,100}[.!?])\s*\n/,  // Capitalized sentence on its own line
  ];

  for (const pattern of taglinePatterns) {
    const match = applyText.match(pattern);
    if (match && match[1]) {
      tagline = match[1].trim();
      if (tagline.length > 10 && tagline.length < 200) {
        break;
      }
    }
  }

  // Extract action items - usually 2 bulleted or numbered items
  const actionItems: string[] = [];

  // Look for bullet points or numbered items
  const bulletPatterns = [
    /[•●○►]\s*([^•●○►\n]+)/g,                    // Bullet points
    /\d+[.)]\s*([^0-9\n][^\n]{30,300})/g,        // Numbered items
    /[-–—]\s*([A-Z][^\n]{30,300})/g,             // Dash items
  ];

  for (const pattern of bulletPatterns) {
    const matches = applyText.matchAll(pattern);
    for (const match of matches) {
      let item = match[1].trim();
      item = item.replace(/\s+/g, ' ').trim();
      if (item.length > 30 && item.length < 400 && !actionItems.includes(item)) {
        actionItems.push(item);
      }
    }
    if (actionItems.length >= 2) break;
  }

  // If we couldn't find action items with bullets, try finding sentences that start with action verbs
  if (actionItems.length < 2) {
    const actionVerbPattern = /\n\s*((?:Look for|Seek out|Consider|Try|Focus on|Make sure|Partner with|Use your|Apply your|Leverage your|Share your)[^.!?]*[.!?])/gi;
    const matches = applyText.matchAll(actionVerbPattern);
    for (const match of matches) {
      let item = match[1].trim();
      item = item.replace(/\s+/g, ' ').trim();
      if (item.length > 30 && item.length < 400 && !actionItems.includes(item)) {
        actionItems.push(item);
      }
      if (actionItems.length >= 2) break;
    }
  }

  // Only return if we have meaningful content
  if (tagline || actionItems.length > 0) {
    return {
      tagline: tagline || "",
      actionItems: actionItems.slice(0, 2),
    };
  }

  return undefined;
}

// Determine report type based on theme count
function determineReportType(themeCount: number): "TOP_5" | "TOP_10" | "ALL_34" {
  if (themeCount >= 30) return "ALL_34";
  if (themeCount >= 8) return "TOP_10";
  return "TOP_5";
}

// Calculate confidence score
function calculateConfidence(themes: ParsedTheme[]): number {
  const validCount = themes.length;

  // Perfect match for expected counts
  if (validCount === 34) return 0.98;
  if (validCount === 10) return 0.95;
  if (validCount === 5) return 0.95;

  // Close to expected counts
  if (validCount >= 32 && validCount <= 34) return 0.9;
  if (validCount >= 8 && validCount <= 12) return 0.85;
  if (validCount >= 4 && validCount <= 6) return 0.85;

  // Reasonable but not exact
  if (validCount >= 3) return 0.7;

  // Low confidence
  return Math.min(validCount * 0.15, 0.6);
}

// Main parsing function
export async function parseCliftonStrengthsPDF(buffer: Buffer): Promise<ParsedStrengthsReport> {
  // Parse PDF to text
  const data = await pdfParse(buffer, {
    // Options for better text extraction
    max: 0, // No page limit
  });

  const text = data.text;

  // Debug logging
  console.log("[PDF Parser] Extracted text length:", text.length);
  console.log("[PDF Parser] Text preview (first 500 chars):", text.substring(0, 500));

  // Extract data
  const participantName = extractParticipantName(text);
  const themes = extractThemes(text);

  console.log("[PDF Parser] Extracted participant name:", participantName);
  console.log("[PDF Parser] Extracted themes count:", themes.length);
  console.log("[PDF Parser] Extracted themes:", themes.map(t => t.name));

  const reportType = determineReportType(themes.length);
  const confidence = calculateConfidence(themes);

  // Include truncated rawText for diagnostics (full text only in development)
  const includeFullText = process.env.NODE_ENV === "development";
  const rawTextForDiagnostics = includeFullText ? text : text.substring(0, 500);

  return {
    participantName,
    themes,
    reportType,
    confidence,
    rawText: rawTextForDiagnostics,
  };
}

// Alternative: Parse from plain text (for testing or manual input)
export function parseStrengthsFromText(text: string, participantName?: string): ParsedStrengthsReport {
  const themes = extractThemes(text);
  const reportType = determineReportType(themes.length);
  const confidence = calculateConfidence(themes);

  return {
    participantName: participantName || extractParticipantName(text),
    themes,
    reportType,
    confidence,
  };
}

// Validate parsed data against expected structure
export function validateParsedReport(report: ParsedStrengthsReport): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check themes
  if (report.themes.length === 0) {
    errors.push("No strength themes found in the document");
  } else if (report.themes.length < 5) {
    warnings.push(`Only ${report.themes.length} themes found. Expected at least 5.`);
  }

  // Check for duplicate ranks
  const ranks = new Set<number>();
  for (const theme of report.themes) {
    if (ranks.has(theme.rank)) {
      errors.push(`Duplicate rank ${theme.rank} found`);
    }
    ranks.add(theme.rank);
  }

  // Check participant name
  if (!report.participantName) {
    warnings.push("Could not extract participant name from document");
  }

  // Check confidence
  if (report.confidence < 0.7) {
    warnings.push(`Low confidence score (${Math.round(report.confidence * 100)}%). Manual verification recommended.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
