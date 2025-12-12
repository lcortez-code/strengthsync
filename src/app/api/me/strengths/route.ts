import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    if (!memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No organization membership found");
    }

    // Fetch all strengths for the current user with full theme details
    const strengths = await prisma.memberStrength.findMany({
      where: {
        memberId,
      },
      include: {
        theme: {
          include: {
            domain: {
              select: {
                slug: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        rank: "asc",
      },
    });

    const response = {
      hasStrengths: strengths.length > 0,
      strengths: strengths.map((s) => ({
        id: s.id,
        rank: s.rank,
        personalizedDescription: s.personalizedDescription,
        theme: {
          slug: s.theme.slug,
          name: s.theme.name,
          shortDescription: s.theme.shortDescription,
          fullDescription: s.theme.fullDescription,
          blindSpots: s.theme.blindSpots,
          actionItems: s.theme.actionItems,
          worksWith: s.theme.worksWith,
          domain: {
            slug: s.theme.domain.slug,
            name: s.theme.domain.name,
          },
        },
      })),
    };

    return apiSuccess(response);
  } catch (error) {
    console.error("[Get My Strengths Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch strengths");
  }
}
