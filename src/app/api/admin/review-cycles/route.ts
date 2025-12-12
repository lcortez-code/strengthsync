import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiError, ApiErrorCode } from "@/lib/api/response";

/**
 * GET /api/admin/review-cycles
 * List all review cycles for the organization
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const cycles = await prisma.reviewCycle.findMany({
      where: {
        organizationId,
        ...(status && { status: status as "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED" }),
      },
      include: {
        _count: {
          select: {
            reviews: true,
          },
        },
      },
      orderBy: {
        startsAt: "desc",
      },
    });

    const formattedCycles = cycles.map((cycle) => ({
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
      reviewCount: cycle._count.reviews,
      createdAt: cycle.createdAt.toISOString(),
    }));

    return apiSuccess(formattedCycles);
  } catch (error) {
    console.error("[Get Review Cycles Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch review cycles");
  }
}

/**
 * POST /api/admin/review-cycles
 * Create a new review cycle
 */
export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const {
      name,
      description,
      cycleType,
      startsAt,
      endsAt,
      includeSelfAssessment = true,
      includeManagerReview = true,
      includePeerFeedback = false,
      includeStrengthsContext = true,
    } = body;

    // Validation
    if (!name || !cycleType || !startsAt || !endsAt) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Missing required fields: name, cycleType, startsAt, endsAt");
    }

    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);

    if (endDate <= startDate) {
      return apiError(ApiErrorCode.BAD_REQUEST, "End date must be after start date");
    }

    const validCycleTypes = ["QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "PROJECT", "PROBATION"];
    if (!validCycleTypes.includes(cycleType)) {
      return apiError(ApiErrorCode.BAD_REQUEST, `Invalid cycle type. Must be one of: ${validCycleTypes.join(", ")}`);
    }

    const cycle = await prisma.reviewCycle.create({
      data: {
        organizationId,
        name,
        description: description || null,
        cycleType,
        startsAt: startDate,
        endsAt: endDate,
        status: "DRAFT",
        includeSelfAssessment,
        includeManagerReview,
        includePeerFeedback,
        includeStrengthsContext,
      },
    });

    return apiCreated({
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
    });
  } catch (error) {
    console.error("[Create Review Cycle Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create review cycle");
  }
}
