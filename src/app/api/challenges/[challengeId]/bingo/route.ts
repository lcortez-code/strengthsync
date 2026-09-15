import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { checkAndAwardBadges } from "@/lib/gamification/badge-engine";
import { canViewFullProfile } from "@/lib/auth/permissions";
import { readAuthJson as readBoundedJson, authProtectionResponse } from "@/lib/auth/request-protection";
import { parseBingoProgress, parseChallengeRules, ChallengeRulesError, type BingoSquare } from "@/lib/challenges/rules";

const markSquareSchema = z.object({ row: z.number().int().min(0).max(4), col: z.number().int().min(0).max(4), memberId: z.string().min(1).max(128) });
class BingoError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string) { super(message); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ challengeId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    const organizationId = session.user.organizationId, myMemberId = session.user.memberId;
    if (!organizationId || !myMemberId) return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    const { challengeId } = await params;
    const validation = markSquareSchema.safeParse(await readBoundedJson(request));
    if (!validation.success) return apiError(ApiErrorCode.VALIDATION_ERROR, "Choose a valid bingo square and member");
    const { row, col, memberId } = validation.data;
    if (memberId === myMemberId) return apiError(ApiErrorCode.BAD_REQUEST, "You must find another team member with this strength");
    const challenge = await prisma.teamChallenge.findFirst({ where: { id: challengeId, organizationId, challengeType: "STRENGTHS_BINGO" } });
    if (!challenge) return apiError(ApiErrorCode.NOT_FOUND, "Bingo challenge not found");
    if (challenge.status !== "ACTIVE") return apiError(ApiErrorCode.BAD_REQUEST, "This challenge is not active");
    const rules = parseChallengeRules(challenge.challengeType, challenge.rules);
    const visibleRank = canViewFullProfile({ viewerRole: session.user.role, viewerMemberId: myMemberId, targetMemberId: memberId }) ? 10 : 5;

    const result = await prisma.$transaction(async tx => {
      // Serialize each board so distinct concurrent squares cannot overwrite progress.
      await tx.$queryRaw`SELECT id FROM challenge_participants WHERE "challengeId" = ${challengeId} AND "memberId" = ${myMemberId} FOR UPDATE`;
      const participant = await tx.challengeParticipant.findUnique({ where: { challengeId_memberId: { challengeId, memberId: myMemberId } } });
      if (!participant) throw new BingoError(ApiErrorCode.NOT_FOUND, "You are not participating in this challenge");
      const progress = parseBingoProgress(participant.progress);
      const square = progress.board[row][col];
      if (square.marked) throw new BingoError(ApiErrorCode.CONFLICT, "This square is already marked");
      if (square.theme === "FREE") throw new BingoError(ApiErrorCode.BAD_REQUEST, "Cannot manually mark the free space");
      const memberWithStrength = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId, status: "ACTIVE", strengths: { some: { theme: { name: square.theme }, rank: { lte: visibleRank } } } },
        select: { user: { select: { fullName: true } } },
      });
      if (!memberWithStrength) throw new BingoError(ApiErrorCode.BAD_REQUEST, "This member does not have a matching strength available to you");
      square.marked = true; square.markedBy = memberId; square.markedByName = memberWithStrength.user.fullName;
      const previousLines = progress.completedLines.length;
      progress.completedLines = checkForBingo(progress.board);
      const marked = countMarkedSquares(progress.board);
      const matchedWin = rules.winCondition === "full_board" ? marked === 25
        : rules.winCondition === "diagonal" ? progress.completedLines.some(line => line.startsWith("diag-"))
        : progress.completedLines.some(line => line.startsWith("row-") || line.startsWith("col-"));
      progress.hasWon = Boolean(participant.completedAt) || matchedWin;
      const score = progress.completedLines.length * 10 + marked;
      await tx.challengeParticipant.update({ where: { id: participant.id }, data: { progress: JSON.parse(JSON.stringify(progress)), score } });
      let firstCompletion = false;
      if (progress.hasWon) {
        const completed = await tx.challengeParticipant.updateMany({ where: { id: participant.id, completedAt: null }, data: { completedAt: new Date() } });
        firstCompletion = completed.count === 1;
        if (firstCompletion) await tx.organizationMember.update({ where: { id: myMemberId }, data: { points: { increment: 50 } } });
      }
      return { marked: true, square, completedLines: progress.completedLines, newLines: progress.completedLines.length - previousLines, hasWon: progress.hasWon, score, firstCompletion };
    });
    if (result.firstCompletion) {
      try { await checkAndAwardBadges(myMemberId, "challenge_completed"); }
      catch { console.error("Challenge completion badge check failed"); }
    }
    const { firstCompletion: _firstCompletion, ...response } = result;
    return apiSuccess(response);
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    if (error instanceof BingoError) return apiError(error.code, error.message);
    if (error instanceof ChallengeRulesError) return apiError(ApiErrorCode.VALIDATION_ERROR, error.message);
    console.error("Bingo square update failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to mark square");
  }
}

function checkForBingo(board: BingoSquare[][]): string[] {
  const lines: string[] = [], size = board.length;
  for (let i = 0; i < size; i++) if (board[i].every(cell => cell.marked)) lines.push(`row-${i}`);
  for (let j = 0; j < size; j++) if (board.every(row => row[j].marked)) lines.push(`col-${j}`);
  if (board.every((row, i) => row[i].marked)) lines.push("diag-main");
  if (board.every((row, i) => row[size - 1 - i].marked)) lines.push("diag-anti");
  return lines;
}
function countMarkedSquares(board: BingoSquare[][]): number { return board.flat().filter(cell => cell.marked).length; }
