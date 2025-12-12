import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiError, ApiErrorCode } from "@/lib/api/response";

/**
 * GET /api/reviews/[reviewId]/evidence
 * Get evidence for a review, including auto-collected from shoutouts
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
        cycle: { organizationId },
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
      include: {
        cycle: true,
        evidence: {
          orderBy: { date: "desc" },
        },
        member: true,
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found");
    }

    // Auto-collect evidence from the review period
    const cycleStart = review.cycle.startsAt;
    const cycleEnd = review.cycle.endsAt;

    // Get shoutouts received during this period
    const shoutoutsReceived = await prisma.shoutout.findMany({
      where: {
        receiverId: review.memberId,
        createdAt: {
          gte: cycleStart,
          lte: cycleEnd,
        },
      },
      include: {
        giver: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        theme: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get shoutouts given during this period
    const shoutoutsGiven = await prisma.shoutout.findMany({
      where: {
        giverId: review.memberId,
        createdAt: {
          gte: cycleStart,
          lte: cycleEnd,
        },
      },
      include: {
        receiver: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        theme: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get skill request responses during this period
    const skillResponses = await prisma.skillRequestResponse.findMany({
      where: {
        responderId: review.memberId,
        status: { in: ["ACCEPTED", "COMPLETED"] },
        createdAt: {
          gte: cycleStart,
          lte: cycleEnd,
        },
      },
      include: {
        request: {
          include: {
            theme: { select: { name: true } },
            creator: {
              include: {
                user: { select: { fullName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get badges earned during this period
    const badgesEarned = await prisma.badgeEarned.findMany({
      where: {
        memberId: review.memberId,
        earnedAt: {
          gte: cycleStart,
          lte: cycleEnd,
        },
      },
      include: {
        badge: true,
      },
      orderBy: { earnedAt: "desc" },
    });

    // Get mentorship activities
    const mentorships = await prisma.mentorship.findMany({
      where: {
        OR: [
          { mentorId: review.memberId },
          { menteeId: review.memberId },
        ],
        status: "ACTIVE",
        startedAt: {
          lte: cycleEnd,
        },
      },
      include: {
        mentor: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        mentee: {
          include: {
            user: { select: { fullName: true } },
          },
        },
      },
    });

    // Track which shoutouts are already added as evidence
    const addedShoutoutIds = new Set(
      review.evidence
        .filter((e) => e.shoutoutId)
        .map((e) => e.shoutoutId)
    );

    // Format available evidence (not yet added)
    const availableEvidence = {
      shoutoutsReceived: shoutoutsReceived
        .filter((s) => !addedShoutoutIds.has(s.id))
        .map((s) => ({
          id: s.id,
          type: "SHOUTOUT_RECEIVED" as const,
          title: `Shoutout from ${s.giver.user.fullName}`,
          description: s.message.length > 100 ? s.message.substring(0, 100) + "..." : s.message,
          fullMessage: s.message,
          date: s.createdAt.toISOString(),
          themeName: s.theme?.name || null,
        })),
      shoutoutsGiven: shoutoutsGiven.map((s) => ({
        id: s.id,
        type: "SHOUTOUT_GIVEN" as const,
        title: `Recognized ${s.receiver.user.fullName}`,
        description: s.message.length > 100 ? s.message.substring(0, 100) + "..." : s.message,
        date: s.createdAt.toISOString(),
        themeName: s.theme?.name || null,
      })),
      skillRequestsHelped: skillResponses.map((sr) => ({
        id: sr.id,
        type: "SKILL_REQUEST_HELPED" as const,
        title: `Helped ${sr.request.creator.user.fullName}: ${sr.request.title}`,
        description: sr.message.length > 100 ? sr.message.substring(0, 100) + "..." : sr.message,
        date: sr.createdAt.toISOString(),
        themeName: sr.request.theme?.name || null,
      })),
      badgesEarned: badgesEarned.map((be) => ({
        id: be.id,
        type: "BADGE_EARNED" as const,
        title: `Earned: ${be.badge.name}`,
        description: be.badge.description,
        date: be.earnedAt.toISOString(),
        badgeIconUrl: be.badge.iconUrl,
      })),
      mentorshipActivities: mentorships.map((m) => ({
        id: m.id,
        type: "MENTORSHIP_ACTIVITY" as const,
        title: m.mentorId === review.memberId
          ? `Mentoring ${m.mentee.user.fullName}`
          : `Learning from ${m.mentor.user.fullName}`,
        description: `Focus areas: ${m.focusAreas.join(", ")}`,
        date: m.startedAt.toISOString(),
        focusAreas: m.focusAreas,
      })),
    };

    // Summary stats
    const stats = {
      shoutoutsReceived: shoutoutsReceived.length,
      shoutoutsGiven: shoutoutsGiven.length,
      skillRequestsHelped: skillResponses.length,
      badgesEarned: badgesEarned.length,
      activeMentorships: mentorships.length,
      addedEvidenceCount: review.evidence.length,
    };

    return apiSuccess({
      evidence: review.evidence.map((e) => ({
        id: e.id,
        evidenceType: e.evidenceType,
        title: e.title,
        description: e.description,
        date: e.date.toISOString(),
        demonstratedThemes: e.demonstratedThemes,
        shoutoutId: e.shoutoutId,
        skillRequestId: e.skillRequestId,
        mentorshipId: e.mentorshipId,
        createdAt: e.createdAt.toISOString(),
      })),
      available: availableEvidence,
      stats,
      period: {
        start: cycleStart.toISOString(),
        end: cycleEnd.toISOString(),
      },
    });
  } catch (error) {
    console.error("[Get Review Evidence Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch evidence");
  }
}

/**
 * POST /api/reviews/[reviewId]/evidence
 * Add evidence to a review
 */
export async function POST(
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
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found or cycle not active");
    }

    const body = await request.json();
    const {
      evidenceType,
      title,
      description,
      date,
      demonstratedThemes,
      shoutoutId,
      skillRequestId,
      mentorshipId,
    } = body;

    if (!evidenceType || !title || !date) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Missing required fields: evidenceType, title, date");
    }

    const validTypes = [
      "SHOUTOUT_RECEIVED",
      "SHOUTOUT_GIVEN",
      "SKILL_REQUEST_HELPED",
      "MENTORSHIP_ACTIVITY",
      "CHALLENGE_COMPLETION",
      "BADGE_EARNED",
      "CUSTOM",
    ];

    if (!validTypes.includes(evidenceType)) {
      return apiError(ApiErrorCode.BAD_REQUEST, `Invalid evidence type. Must be one of: ${validTypes.join(", ")}`);
    }

    const evidence = await prisma.reviewEvidence.create({
      data: {
        reviewId,
        evidenceType,
        title,
        description: description || null,
        date: new Date(date),
        demonstratedThemes: demonstratedThemes || [],
        shoutoutId: shoutoutId || null,
        skillRequestId: skillRequestId || null,
        mentorshipId: mentorshipId || null,
        addedBy: memberId,
      },
    });

    return apiCreated({
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      title: evidence.title,
      description: evidence.description,
      date: evidence.date.toISOString(),
      demonstratedThemes: evidence.demonstratedThemes,
      createdAt: evidence.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("[Create Review Evidence Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to add evidence");
  }
}

/**
 * DELETE /api/reviews/[reviewId]/evidence
 * Delete evidence (via query param ?evidenceId=xxx)
 */
export async function DELETE(
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

    const { searchParams } = new URL(request.url);
    const evidenceId = searchParams.get("evidenceId");

    if (!evidenceId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Evidence ID required");
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: { organizationId, status: "ACTIVE" },
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found");
    }

    await prisma.reviewEvidence.deleteMany({
      where: {
        id: evidenceId,
        reviewId,
      },
    });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("[Delete Review Evidence Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete evidence");
  }
}
