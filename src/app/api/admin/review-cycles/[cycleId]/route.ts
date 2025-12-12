import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

/**
 * GET /api/admin/review-cycles/[cycleId]
 * Get a specific review cycle with details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Check admin access
    if (session.user.role !== "ADMIN" && session.user.role !== "OWNER") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const cycle = await prisma.reviewCycle.findFirst({
      where: {
        id: cycleId,
        organizationId,
      },
      include: {
        reviews: {
          include: {
            member: {
              include: {
                user: {
                  select: {
                    fullName: true,
                    avatarUrl: true,
                    jobTitle: true,
                  },
                },
              },
            },
            reviewer: {
              include: {
                user: {
                  select: {
                    fullName: true,
                  },
                },
              },
            },
            _count: {
              select: {
                goals: true,
                evidence: true,
              },
            },
          },
        },
      },
    });

    if (!cycle) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review cycle not found");
    }

    const formattedCycle = {
      id: cycle.id,
      name: cycle.name,
      description: cycle.description,
      cycleType: cycle.cycleType,
      startsAt: cycle.startsAt.toISOString(),
      endsAt: cycle.endsAt.toISOString(),
      status: cycle.status,
      includeSelfAssessment: cycle.includeSelfAssessment,
      includeManagerReview: cycle.includeManagerReview,
      includePeerFeedback: cycle.includePeerFeedback,
      includeStrengthsContext: cycle.includeStrengthsContext,
      createdAt: cycle.createdAt.toISOString(),
      reviews: cycle.reviews.map((review) => ({
        id: review.id,
        status: review.status,
        overallRating: review.overallRating,
        member: {
          id: review.member.id,
          name: review.member.user.fullName,
          avatarUrl: review.member.user.avatarUrl,
          jobTitle: review.member.user.jobTitle,
        },
        reviewer: review.reviewer
          ? {
              id: review.reviewer.id,
              name: review.reviewer.user.fullName,
            }
          : null,
        goalCount: review._count.goals,
        evidenceCount: review._count.evidence,
        selfAssessmentAt: review.selfAssessmentAt?.toISOString() || null,
        managerAssessmentAt: review.managerAssessmentAt?.toISOString() || null,
        completedAt: review.completedAt?.toISOString() || null,
      })),
      stats: {
        totalReviews: cycle.reviews.length,
        completed: cycle.reviews.filter((r) => r.status === "COMPLETED" || r.status === "ACKNOWLEDGED").length,
        inProgress: cycle.reviews.filter((r) => r.status === "SELF_ASSESSMENT" || r.status === "MANAGER_REVIEW").length,
        notStarted: cycle.reviews.filter((r) => r.status === "NOT_STARTED").length,
      },
    };

    return apiSuccess(formattedCycle);
  } catch (error) {
    console.error("[Get Review Cycle Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch review cycle");
  }
}

/**
 * PATCH /api/admin/review-cycles/[cycleId]
 * Update a review cycle
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Check admin access
    if (session.user.role !== "ADMIN" && session.user.role !== "OWNER") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const cycle = await prisma.reviewCycle.findFirst({
      where: {
        id: cycleId,
        organizationId,
      },
    });

    if (!cycle) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review cycle not found");
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    // Handle status changes
    if (body.status) {
      const validStatuses = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"];
      if (!validStatuses.includes(body.status)) {
        return apiError(ApiErrorCode.BAD_REQUEST, `Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }

      // When activating, create reviews for all active members
      if (body.status === "ACTIVE" && cycle.status === "DRAFT") {
        const members = await prisma.organizationMember.findMany({
          where: {
            organizationId,
            status: "ACTIVE",
          },
          select: { id: true },
        });

        // Create reviews for members who don't have one yet
        const existingReviews = await prisma.performanceReview.findMany({
          where: { cycleId },
          select: { memberId: true },
        });
        const existingMemberIds = new Set(existingReviews.map((r) => r.memberId));

        const newReviews = members
          .filter((m) => !existingMemberIds.has(m.id))
          .map((m) => ({
            cycleId,
            memberId: m.id,
            status: "NOT_STARTED" as const,
          }));

        if (newReviews.length > 0) {
          await prisma.performanceReview.createMany({
            data: newReviews,
          });
        }
      }

      updateData.status = body.status;
    }

    // Handle other field updates (only for DRAFT cycles)
    if (cycle.status === "DRAFT") {
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description || null;
      if (body.cycleType !== undefined) {
        const validCycleTypes = ["QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "PROJECT", "PROBATION"];
        if (!validCycleTypes.includes(body.cycleType)) {
          return apiError(ApiErrorCode.BAD_REQUEST, "Invalid cycle type");
        }
        updateData.cycleType = body.cycleType;
      }
      if (body.startsAt !== undefined) updateData.startsAt = new Date(body.startsAt);
      if (body.endsAt !== undefined) updateData.endsAt = new Date(body.endsAt);
      if (body.includeSelfAssessment !== undefined) updateData.includeSelfAssessment = body.includeSelfAssessment;
      if (body.includeManagerReview !== undefined) updateData.includeManagerReview = body.includeManagerReview;
      if (body.includePeerFeedback !== undefined) updateData.includePeerFeedback = body.includePeerFeedback;
      if (body.includeStrengthsContext !== undefined) updateData.includeStrengthsContext = body.includeStrengthsContext;
    }

    const updated = await prisma.reviewCycle.update({
      where: { id: cycleId },
      data: updateData,
    });

    return apiSuccess({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      cycleType: updated.cycleType,
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString(),
      status: updated.status,
      includeSelfAssessment: updated.includeSelfAssessment,
      includeManagerReview: updated.includeManagerReview,
      includePeerFeedback: updated.includePeerFeedback,
      includeStrengthsContext: updated.includeStrengthsContext,
    });
  } catch (error) {
    console.error("[Update Review Cycle Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update review cycle");
  }
}

/**
 * DELETE /api/admin/review-cycles/[cycleId]
 * Delete a review cycle (only if DRAFT)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Check admin access
    if (session.user.role !== "ADMIN" && session.user.role !== "OWNER") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const cycle = await prisma.reviewCycle.findFirst({
      where: {
        id: cycleId,
        organizationId,
      },
    });

    if (!cycle) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review cycle not found");
    }

    // Only allow deleting DRAFT or CANCELLED cycles
    if (cycle.status !== "DRAFT" && cycle.status !== "CANCELLED") {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "Can only delete review cycles in DRAFT or CANCELLED status"
      );
    }

    await prisma.reviewCycle.delete({
      where: { id: cycleId },
    });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("[Delete Review Cycle Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete review cycle");
  }
}
