import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

/**
 * GET /api/reviews
 * List user's performance reviews
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const role = searchParams.get("role"); // "subject" or "reviewer"

    // Get reviews where user is either the subject or the reviewer
    const whereClause = role === "reviewer"
      ? { reviewerId: memberId }
      : role === "subject"
        ? { memberId }
        : {
            OR: [
              { memberId },
              { reviewerId: memberId },
            ],
          };

    const reviews = await prisma.performanceReview.findMany({
      where: {
        ...whereClause,
        cycle: {
          organizationId,
        },
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
              },
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
        _count: {
          select: {
            goals: true,
            evidence: true,
          },
        },
      },
      orderBy: {
        cycle: {
          startsAt: "desc",
        },
      },
    });

    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      status: review.status,
      overallRating: review.overallRating,
      isMyReview: review.memberId === memberId,
      isReviewer: review.reviewerId === memberId,
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
      },
      reviewer: review.reviewer
        ? {
            id: review.reviewer.id,
            name: review.reviewer.user.fullName,
            avatarUrl: review.reviewer.user.avatarUrl,
          }
        : null,
      goalCount: review._count.goals,
      evidenceCount: review._count.evidence,
      selfAssessmentAt: review.selfAssessmentAt?.toISOString() || null,
      managerAssessmentAt: review.managerAssessmentAt?.toISOString() || null,
      submittedAt: review.submittedAt?.toISOString() || null,
      completedAt: review.completedAt?.toISOString() || null,
      createdAt: review.createdAt.toISOString(),
    }));

    // Separate into my reviews and reviews I'm conducting
    const myReviews = formattedReviews.filter((r) => r.isMyReview);
    const reviewsToConduct = formattedReviews.filter((r) => r.isReviewer && !r.isMyReview);

    return apiSuccess({
      myReviews,
      reviewsToConduct,
      total: formattedReviews.length,
    });
  } catch (error) {
    console.error("[Get Reviews Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch reviews");
  }
}
