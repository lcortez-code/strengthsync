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

    // Check admin role
    const isAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
    if (!isAdmin) {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const domains = await prisma.strengthDomain.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { themes: true },
        },
      },
    });

    return apiSuccess(domains);
  } catch (error) {
    console.error("[Admin Constants Domains Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch domains");
  }
}
