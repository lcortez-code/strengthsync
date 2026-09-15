import { readAuthJson, protectAuthRequest, authProtectionResponse, passwordSchema, emailSchema, inviteCodeSchema } from "@/lib/auth/request-protection";
import { requireInvitationEmail, sendEmailVerification } from "@/lib/auth/account-emails";
import { NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode, apiCreated } from "@/lib/api/response";

// Schema for validating invite code only
const validateCodeSchema = z.object({
  inviteCode: inviteCodeSchema,
});

// Schema for joining with new account
const joinSchema = z.object({
  inviteCode: inviteCodeSchema,
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(200),
});

// GET - Validate invite code and return org info
export async function GET(request: NextRequest) {
  try {
    await protectAuthRequest("invite-code", request.headers);
    const { searchParams } = new URL(request.url);
    const inviteCode = searchParams.get("code");

    if (!inviteCodeSchema.safeParse(inviteCode).success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invite code is required");
    }

    const organization = await prisma.organization.findFirst({
      where: {
        inviteCode: inviteCode!.toUpperCase(),
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
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Invite code validation failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to validate invite code");
  }
}

// POST - Join organization with new account
export async function POST(request: NextRequest) {
  try {
    const body = await readAuthJson(request);
    const validation = joinSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { inviteCode, email, password, fullName } = validation.data;
    const normalizedEmail = email.toLowerCase();
    await protectAuthRequest("join", request.headers, normalizedEmail);
    requireInvitationEmail();
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
          emailVerificationRequired: true,
          emailVerified: false,
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

    let verificationSent = true;
    try { await sendEmailVerification(result.user); } catch { verificationSent = false; }

    return apiCreated(
      {
        verificationRequired: true,
        verificationSent,
        userId: result.user.id,
        memberId: result.membership.id,
        organizationId: organization.id,
        organizationName: organization.name,
      },
      "Account created. Verify your email before signing in."
    );
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Account join failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to join organization");
  }
}
