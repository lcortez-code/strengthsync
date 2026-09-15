import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    // Check admin role
    if (!isPlatformAdmin(session.user.id)) {
      return apiError(ApiErrorCode.FORBIDDEN, "Platform administrator access required");
    }

    const themes = await prisma.strengthTheme.findMany({
      orderBy: [
        { domain: { name: "asc" } },
        { name: "asc" },
      ],
      include: {
        domain: {
          select: { name: true, slug: true },
        },
      },
    });

    return apiSuccess(themes);
  } catch (error) {
    console.error("[Admin Constants Themes Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch themes");
  }
}
