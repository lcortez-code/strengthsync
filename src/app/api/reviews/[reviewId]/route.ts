import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { withReviewWrite, reviewWriteError } from "@/lib/reviews/workflow";
import { serializeReviewGoal } from "@/lib/reviews/goals";

/**
 * GET /api/reviews/[reviewId]
 * Get a specific review with full details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  try {
    const { reviewId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: {
          organizationId,
        },
        // User must be subject, reviewer, or admin
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
      include: {
        cycle: {
          select: {
            id: true,
            name: true,
            cycleType: true,
            startsAt: true,
            endsAt: true,
            status: true,
            includeSelfAssessment: true,
            includeManagerReview: true,
            includeStrengthsContext: true,
          },
        },
        member: {
          include: {
            user: {
              select: {
                fullName: true,
                avatarUrl: true,
                jobTitle: true,
                department: true,
              },
            },
            strengths: {
              where: { rank: { lte: 10 } },
              include: {
                theme: {
                  include: {
                    domain: { select: { slug: true, name: true } },
                  },
                },
              },
              orderBy: { rank: "asc" },
            },
          },
        },
        reviewer: {
          include: {
            user: {
              select: {
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
        goals: {
          orderBy: { createdAt: "asc" },
        },
        evidence: {
          orderBy: { date: "desc" },
        },
      },
    });

    // If not found via member/reviewer, check admin access
    if (!review) {
      const isAdmin = session.user.role === "ADMIN" || session.user.role === "OWNER";
      if (isAdmin) {
        const adminReview = await prisma.performanceReview.findFirst({
          where: {
            id: reviewId,
            cycle: { organizationId },
          },
          include: {
            cycle: true,
            member: {
              include: {
                user: { select: { fullName: true, avatarUrl: true, jobTitle: true, department: true } },
                strengths: {
                  where: { rank: { lte: 10 } },
                  include: { theme: { include: { domain: { select: { slug: true, name: true } } } } },
                  orderBy: { rank: "asc" },
                },
              },
            },
            reviewer: {
              include: { user: { select: { fullName: true, avatarUrl: true } } },
            },
            goals: { orderBy: { createdAt: "asc" } },
            evidence: { orderBy: { date: "desc" } },
          },
        });
        if (adminReview) {
          return formatReviewResponse(adminReview, memberId, true);
        }
      }
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found");
    }

    return formatReviewResponse(review, memberId, session.user.role === "ADMIN" || session.user.role === "OWNER");
  } catch (error) {
    console.error("[Get Review Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch review");
  }
}

function formatReviewResponse(review: any, currentMemberId: string, isAdmin: boolean) {
  const isSubject = review.memberId === currentMemberId;
  const isReviewer = review.reviewerId === currentMemberId;

  return apiSuccess({
    id: review.id,
    status: review.status,
    isSubject,
    isReviewer,
    isAdmin,
    cycle: {
      id: review.cycle.id,
      name: review.cycle.name,
      cycleType: review.cycle.cycleType,
      startsAt: review.cycle.startsAt.toISOString(),
      endsAt: review.cycle.endsAt.toISOString(),
      status: review.cycle.status,
      includeSelfAssessment: review.cycle.includeSelfAssessment,
      includeManagerReview: review.cycle.includeManagerReview,
      includeStrengthsContext: review.cycle.includeStrengthsContext,
    },
    member: {
      id: review.member.id,
      name: review.member.user.fullName,
      avatarUrl: review.member.user.avatarUrl,
      jobTitle: review.member.user.jobTitle,
      department: review.member.user.department,
      strengths: review.member.strengths.map((s: any) => ({
        rank: s.rank,
        name: s.theme.name,
        domainSlug: s.theme.domain.slug,
        domainName: s.theme.domain.name,
        shortDescription: s.theme.shortDescription,
      })),
    },
    reviewer: review.reviewer
      ? {
          id: review.reviewer.id,
          name: review.reviewer.user.fullName,
          avatarUrl: review.reviewer.user.avatarUrl,
        }
      : null,
    selfAssessment: review.selfAssessment,
    selfAssessmentAt: review.selfAssessmentAt?.toISOString() || null,
    strengthsUsed: review.strengthsUsed,
    managerAssessment: isReviewer || isAdmin ? review.managerAssessment : null,
    managerAssessmentAt: review.managerAssessmentAt?.toISOString() || null,
    overallRating: review.overallRating,
    strengthsContext: review.strengthsContext,
    goals: review.goals.map((g: Parameters<typeof serializeReviewGoal>[0]) => serializeReviewGoal(g, isReviewer || isAdmin)),
    evidence: review.evidence.map((e: any) => ({
      id: e.id,
      evidenceType: e.evidenceType,
      title: e.title,
      description: e.description,
      date: e.date.toISOString(),
      demonstratedThemes: e.demonstratedThemes,
      shoutoutId: e.shoutoutId,
      skillRequestId: e.skillRequestId,
      mentorshipId: e.mentorshipId,
    })),
    submittedAt: review.submittedAt?.toISOString() || null,
    completedAt: review.completedAt?.toISOString() || null,
    createdAt: review.createdAt.toISOString(),
  });
}

/**
 * PATCH /api/reviews/[reviewId]
 * Update a review (self-assessment or manager review)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  try {
    const { reviewId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: {
          organizationId,
          status: "ACTIVE",
        },
      },
      include: {
        cycle: true,
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found or cycle not active");
    }

    const isSubject = review.memberId === memberId;
    const isReviewer = review.reviewerId === memberId;
    const isAdmin = session.user.role === "ADMIN" || session.user.role === "OWNER";

    if (!isSubject && !isReviewer && !isAdmin) {
      return apiError(ApiErrorCode.FORBIDDEN, "You don't have permission to update this review");
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    const selfEdit = ["selfAssessment", "strengthsUsed", "submitSelfAssessment"].some(key => body[key] !== undefined);
    const managerEdit = ["managerAssessment", "overallRating", "completeReview"].some(key => body[key] !== undefined);
    if (selfEdit && (!isSubject || !review.cycle.includeSelfAssessment || !["NOT_STARTED", "SELF_ASSESSMENT"].includes(review.status)))
      return apiError(ApiErrorCode.FORBIDDEN, "Self-assessment is no longer editable");
    if (managerEdit && (!(isReviewer || isAdmin) || !review.cycle.includeManagerReview || (review.status !== "MANAGER_REVIEW" && !(review.status === "NOT_STARTED" && !review.cycle.includeSelfAssessment))))
      return apiError(ApiErrorCode.FORBIDDEN, "Manager review is not editable in this phase");
    if (body.acknowledge !== undefined && (!isSubject || review.status !== "COMPLETED" || selfEdit || managerEdit || body.reviewerId !== undefined))
      return apiError(ApiErrorCode.FORBIDDEN, "Only the subject can acknowledge a completed review");
    if (body.reviewerId !== undefined && (!isAdmin || ["COMPLETED", "ACKNOWLEDGED"].includes(review.status)))
      return apiError(ApiErrorCode.FORBIDDEN, "Reviewer assignment is closed");


    // Self-assessment updates (subject only)
    if (isSubject && review.cycle.includeSelfAssessment) {
      if (body.selfAssessment !== undefined) {
        updateData.selfAssessment = body.selfAssessment;
        updateData.selfAssessmentAt = new Date();
      }
      if (body.strengthsUsed !== undefined) {
        updateData.strengthsUsed = body.strengthsUsed;
      }
      if (body.submitSelfAssessment) {
        updateData.status = review.cycle.includeManagerReview ? "MANAGER_REVIEW" : "COMPLETED";
        if (!review.cycle.includeManagerReview) updateData.completedAt = new Date();
        updateData.submittedAt = new Date();
      }
    }

    // Manager assessment updates (reviewer only)
    if ((isReviewer || isAdmin) && review.cycle.includeManagerReview && managerEdit) {
      if (review.status === "NOT_STARTED") updateData.status = "MANAGER_REVIEW";
      if (body.managerAssessment !== undefined) {
        updateData.managerAssessment = body.managerAssessment;
        updateData.managerAssessmentAt = new Date();
      }
      if (body.overallRating !== undefined) {
        const validRatings = ["EXCEEDS_EXPECTATIONS", "MEETS_EXPECTATIONS", "DEVELOPING", "NEEDS_IMPROVEMENT"];
        if (!validRatings.includes(body.overallRating)) {
          return apiError(ApiErrorCode.BAD_REQUEST, "Invalid rating");
        }
        updateData.overallRating = body.overallRating;
      }
      if (body.completeReview) {
        updateData.status = "COMPLETED";
        updateData.completedAt = new Date();
      }
    }

    // Acknowledge completion (subject only)
    if (isSubject && body.acknowledge && review.status === "COMPLETED") {
      updateData.status = "ACKNOWLEDGED";
    }

    // Assign reviewer (admin only)
    if (isAdmin && body.reviewerId !== undefined) {
      if (body.reviewerId) {
        if (typeof body.reviewerId !== "string") {
          return apiError(ApiErrorCode.BAD_REQUEST, "Invalid reviewer");
        }
        const reviewer = await prisma.organizationMember.findFirst({
          where: { id: body.reviewerId, organizationId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!reviewer) return apiError(ApiErrorCode.NOT_FOUND, "Reviewer not found in your organization");
      }
      updateData.reviewerId = body.reviewerId || null;
    }

    if (Object.keys(updateData).length === 0) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No valid updates provided");
    }

    const updated = await withReviewWrite(review, organizationId, tx => tx.performanceReview.update({
      where: { id: reviewId }, data: updateData,
    }));

    return apiSuccess({
      id: updated.id,
      status: updated.status,
      selfAssessmentAt: updated.selfAssessmentAt?.toISOString() || null,
      managerAssessmentAt: updated.managerAssessmentAt?.toISOString() || null,
      overallRating: updated.overallRating,
      submittedAt: updated.submittedAt?.toISOString() || null,
      completedAt: updated.completedAt?.toISOString() || null,
    });
  } catch (error) {
    const conflict = reviewWriteError(error);
    if (conflict) return conflict;
    console.error("[Update Review Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update review");
  }
}
