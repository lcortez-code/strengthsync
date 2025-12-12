import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const updateThemeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  shortDescription: z.string().max(500).optional(),
  fullDescription: z.string().max(5000).optional(),
  blindSpots: z.array(z.string().max(500)).optional(),
  actionItems: z.array(z.string().max(500)).optional(),
  worksWith: z.array(z.string().max(100)).optional(),
  keywords: z.array(z.string().max(100)).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // Verify theme exists
    const existingTheme = await prisma.strengthTheme.findUnique({
      where: { id },
    });

    if (!existingTheme) {
      return apiError(ApiErrorCode.NOT_FOUND, "Theme not found");
    }

    const body = await request.json();
    const validation = updateThemeSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const updatedTheme = await prisma.strengthTheme.update({
      where: { id },
      data: validation.data,
      include: {
        domain: {
          select: { name: true, slug: true },
        },
      },
    });

    console.log(`[Admin] Theme ${id} updated by user ${session.user.id}`);

    return apiSuccess(updatedTheme);
  } catch (error) {
    console.error("[Admin Constants Theme Update Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update theme");
  }
}
