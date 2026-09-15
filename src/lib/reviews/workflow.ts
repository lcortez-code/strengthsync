import type { Prisma, ReviewStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, ApiErrorCode } from "@/lib/api/response";

type ReviewIdentity = { id: string; memberId: string; reviewerId: string | null; status: ReviewStatus };
export function canEditReviewContent(review: ReviewIdentity & { cycle: { includeSelfAssessment: boolean; includeManagerReview: boolean } }, memberId: string): boolean {
  return (review.cycle.includeSelfAssessment && review.memberId === memberId && ["NOT_STARTED", "SELF_ASSESSMENT"].includes(review.status)) ||
    (review.cycle.includeManagerReview && review.reviewerId === memberId && (review.status === "MANAGER_REVIEW" || (review.status === "NOT_STARTED" && !review.cycle.includeSelfAssessment)));
}
class ReviewWriteConflict extends Error {}
export function reviewWriteError(error: unknown): Response | null {
  return error instanceof ReviewWriteConflict ? apiError(ApiErrorCode.CONFLICT, "Review changed or is no longer editable. Refresh and try again.") : null;
}
export async function withReviewWrite<T>(review: ReviewIdentity, organizationId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    // Serialize completion and child edits on the parent row; recheck captured authority/state.
    const locked = await tx.performanceReview.updateMany({
      where: { id: review.id, memberId: review.memberId, reviewerId: review.reviewerId, status: review.status, cycle: { organizationId, status: "ACTIVE" } },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) throw new ReviewWriteConflict();
    return work(tx);
  });
}
