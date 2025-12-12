import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const updateDomainSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  colorName: z.string().max(50).optional(),
  iconName: z.string().max(50).optional(),
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

    // Verify domain exists
    const existingDomain = await prisma.strengthDomain.findUnique({
      where: { id },
    });

    if (!existingDomain) {
      return apiError(ApiErrorCode.NOT_FOUND, "Domain not found");
    }

    const body = await request.json();
    const validation = updateDomainSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const updatedDomain = await prisma.strengthDomain.update({
      where: { id },
      data: validation.data,
      include: {
        _count: {
          select: { themes: true },
        },
      },
    });

    console.log(`[Admin] Domain ${id} updated by user ${session.user.id}`);

    return apiSuccess(updatedDomain);
  } catch (error) {
    console.error("[Admin Constants Domain Update Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update domain");
  }
}
