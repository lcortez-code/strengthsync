import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode, apiCreated } from "@/lib/api/response";

const joinSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required"),
});

// POST - Join organization (for authenticated users)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const body = await request.json();
    const validation = joinSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { inviteCode } = validation.data;
    const normalizedCode = inviteCode.toUpperCase();

    // Find organization by invite code
    const organization = await prisma.organization.findFirst({
      where: {
        inviteCode: normalizedCode,
        inviteCodeEnabled: true,
      },
    });

    if (!organization) {
      return apiError(ApiErrorCode.NOT_FOUND, "Invalid or expired invite code");
    }

    // Check if user is already a member
    const existingMembership = await prisma.organizationMember.findFirst({
      where: {
        userId: session.user.id,
        organizationId: organization.id,
      },
    });

    if (existingMembership) {
      return apiError(
        ApiErrorCode.CONFLICT,
        "You are already a member of this organization"
      );
    }

    // Get user's full name for feed item
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { fullName: true },
    });

    // Create membership
    const membership = await prisma.$transaction(async (tx) => {
      const newMembership = await tx.organizationMember.create({
        data: {
          userId: session.user.id,
          organizationId: organization.id,
          role: "MEMBER",
          status: "ACTIVE",
        },
      });

      // Create feed item for new member
      await tx.feedItem.create({
        data: {
          organizationId: organization.id,
          creatorId: newMembership.id,
          itemType: "NEW_MEMBER",
          content: JSON.parse(
            JSON.stringify({
              memberName: user?.fullName || "New Member",
              memberId: newMembership.id,
            })
          ),
        },
      });

      return newMembership;
    });

    return apiCreated(
      {
        memberId: membership.id,
        organizationId: organization.id,
        organizationName: organization.name,
      },
      "Successfully joined organization"
    );
  } catch (error) {
    console.error("[Join Organization Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to join organization");
  }
}
