import { z } from "zod";

export const BINGO_GRID_SIZE = 5;
export const bingoRulesSchema = z.object({
  gridSize: z.literal(BINGO_GRID_SIZE).default(BINGO_GRID_SIZE),
  winCondition: z.enum(["row_or_column", "diagonal", "full_board"]).default("row_or_column"),
  themesPerSquare: z.literal(1).default(1),
}).strict();

const ruleSchemas = {
  STRENGTHS_BINGO: bingoRulesSchema,
  SHOUTOUT_STREAK: z.object({ targetDays: z.number().int().min(1).max(366).default(7), shoutoutsPerDay: z.number().int().min(1).max(100).default(1) }).strict(),
  MENTORSHIP_MONTH: z.object({ sessionsRequired: z.number().int().min(1).max(100).default(4), durationMinutes: z.number().int().min(1).max(480).default(30) }).strict(),
  COLLABORATION_QUEST: z.object({ tasksRequired: z.number().int().min(1).max(100).default(5), uniquePartnersRequired: z.number().int().min(1).max(100).default(3) }).strict(),
  MANIFESTO_EXERCISE: z.object({}).strict(),
  THEME_OF_THE_WEEK: z.object({}).strict(),
};
export class ChallengeRulesError extends Error {}
export function parseChallengeRules(type: string, rules: unknown): Record<string, unknown> {
  const schema = ruleSchemas[type as keyof typeof ruleSchemas];
  const parsed = schema?.safeParse(rules === undefined ? {} : rules);
  if (!parsed?.success) throw new ChallengeRulesError(type === "STRENGTHS_BINGO"
    ? "Unsupported bingo rules. Use a 5-by-5 board and a supported win condition."
    : "Challenge rules contain unsupported values.");
  return parsed.data;
}

const squareSchema = z.object({
  theme: z.string().min(1).max(100), domain: z.string().min(1).max(64), marked: z.boolean(),
  markedBy: z.string().max(128).optional(), markedByName: z.string().max(200).optional(),
});
export const bingoProgressSchema = z.object({
  board: z.array(z.array(squareSchema).length(BINGO_GRID_SIZE)).length(BINGO_GRID_SIZE),
  completedLines: z.array(z.string().max(16)).max(12), hasWon: z.boolean(),
});
export type BingoProgress = z.infer<typeof bingoProgressSchema>;
export type BingoSquare = BingoProgress["board"][number][number];
export function parseBingoProgress(value: unknown): BingoProgress {
  const board = value && typeof value === "object" && "board" in value ? value.board : null;
  if (!Array.isArray(board) || board.length !== BINGO_GRID_SIZE || !board.every(row => Array.isArray(row) && row.length === BINGO_GRID_SIZE)) {
    throw new ChallengeRulesError("This bingo board is invalid. Ask an administrator to create a new challenge.");
  }
  const parsed = bingoProgressSchema.safeParse(value);
  if (!parsed.success) throw new ChallengeRulesError("This bingo board is invalid. Ask an administrator to create a new challenge.");
  return parsed.data;
}
