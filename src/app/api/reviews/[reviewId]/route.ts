import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

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

    return formatReviewResponse(review, memberId, false);
  } catch (error) {
    console.error("[Get Review Error]", error);
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
    goals: review.goals.map((g: any) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      category: g.category,
      alignedThemes: g.alignedThemes,
      suggestedByAI: g.suggestedByAI,
      status: g.status,
      progress: g.progress,
      selfRating: g.selfRating,
      managerRating: isReviewer || isAdmin ? g.managerRating : null,
      comments: g.comments,
      dueDate: g.dueDate?.toISOString() || null,
    })),
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
        updateData.status = "MANAGER_REVIEW";
        updateData.submittedAt = new Date();
      }
    }

    // Manager assessment updates (reviewer only)
    if ((isReviewer || isAdmin) && review.cycle.includeManagerReview) {
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
      updateData.reviewerId = body.reviewerId || null;
    }

    if (Object.keys(updateData).length === 0) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No valid updates provided");
    }

    const updated = await prisma.performanceReview.update({
      where: { id: reviewId },
      data: updateData,
    });

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
    console.error("[Update Review Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update review");
  }
}
