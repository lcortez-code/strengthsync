import { NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode, apiCreated } from "@/lib/api/response";

// Schema for validating invite code only
const validateCodeSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required"),
});

// Schema for joining with new account
const joinSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2, "Name must be at least 2 characters"),
});

// GET - Validate invite code and return org info
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const inviteCode = searchParams.get("code");

    if (!inviteCode) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invite code is required");
    }

    const organization = await prisma.organization.findFirst({
      where: {
        inviteCode: inviteCode.toUpperCase(),
        inviteCodeEnabled: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        _count: {
          select: {
            members: {
              where: { status: "ACTIVE" },
            },
          },
        },
      },
    });

    if (!organization) {
      return apiError(ApiErrorCode.NOT_FOUND, "Invalid or expired invite code");
    }

    return apiSuccess({
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      logoUrl: organization.logoUrl,
      memberCount: organization._count.members,
    });
  } catch (error) {
    console.error("[Validate Invite Code Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to validate invite code");
  }
}

// POST - Join organization with new account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = joinSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { inviteCode, email, password, fullName } = validation.data;
    const normalizedEmail = email.toLowerCase();
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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        organizationMemberships: {
          where: { organizationId: organization.id },
        },
      },
    });

    if (existingUser) {
      // Check if already a member of this org
      if (existingUser.organizationMemberships.length > 0) {
        return apiError(
          ApiErrorCode.CONFLICT,
          "You are already a member of this organization"
        );
      }

      // User exists but not in this org - they should login and join
      return apiError(
        ApiErrorCode.CONFLICT,
        "An account with this email already exists. Please login to join this organization."
      );
    }

    // Create user and membership in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const passwordHash = await hash(password, 12);

      // Create user
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName,
        },
      });

      // Create membership
      const membership = await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: "MEMBER",
          status: "ACTIVE",
        },
      });

      // Create feed item for new member
      await tx.feedItem.create({
        data: {
          organizationId: organization.id,
          creatorId: membership.id,
          itemType: "NEW_MEMBER",
          content: JSON.parse(
            JSON.stringify({
              memberName: fullName,
              memberId: membership.id,
            })
          ),
        },
      });

      return { user, membership };
    });

    return apiCreated(
      {
        userId: result.user.id,
        memberId: result.membership.id,
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
