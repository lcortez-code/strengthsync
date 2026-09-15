import { boundedPageNumber } from "@/lib/api/pagination";
import { readAuthJson, protectAuthRequest, authProtectionResponse, emailSchema } from "@/lib/auth/request-protection";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiListSuccess, apiError, ApiErrorCode, apiCreated } from "@/lib/api/response";
import { requireInvitationEmail, sendMemberInvitation } from "@/lib/auth/account-emails";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const role = session.user.role;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Only admins can view member management
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = boundedPageNumber(searchParams.get("page"), 1, 10000);
    const limit = boundedPageNumber(searchParams.get("limit"), 20, 100);

    const where: Record<string, unknown> = { organizationId };

    if (status && ["ACTIVE", "INACTIVE", "PENDING"].includes(status)) {
      where.status = status;
    }

    if (search) {
      where.user = {
        OR: [
          { fullName: { contains: search, mode: "insensitive" }, organizationMemberships: { some: { organizationId, status: { not: "PENDING" } } } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const total = await prisma.organizationMember.count({ where });

    const members = await prisma.organizationMember.findMany({
      where,
      include: {
        user: {
          select: {
        id: true,
        email: true,
            fullName: true,
            avatarUrl: true,
            jobTitle: true,
            department: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        strengths: {
          where: { rank: { lte: 5 } },
          include: {
            theme: { include: { domain: { select: { slug: true } } } },
          },
          orderBy: { rank: "asc" },
        },
        _count: {
          select: {
            shoutoutsReceived: true,
            shoutoutsGiven: true,
          },
        },
      },
      orderBy: [
        { role: "asc" },
        { joinedAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.status === "PENDING" ? "Invitation pending" : m.user.fullName,
      avatarUrl: m.status === "PENDING" ? null : m.user.avatarUrl,
      jobTitle: m.status === "PENDING" ? null : m.user.jobTitle,
      department: m.status === "PENDING" ? null : m.user.department,
      role: m.role,
      status: m.status,
      points: m.points,
      streak: m.streak,
      hasStrengths: m.strengths.length > 0,
      topStrengths: m.strengths.map((s) => ({
        name: s.theme.name,
        domain: s.theme.domain.slug,
      })),
      shoutoutsReceived: m._count.shoutoutsReceived,
      shoutoutsGiven: m._count.shoutoutsGiven,
      joinedAt: m.joinedAt.toISOString(),
      lastLoginAt: m.status === "PENDING" ? null : m.user.lastLoginAt?.toISOString(),
    }));

    return apiListSuccess(data, {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Member listing failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch members");
  }
}

const createMemberSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(254),
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  jobTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  role: z.enum(["MEMBER", "MANAGER", "ADMIN"]).default("MEMBER"),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const userRole = session.user.role;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Only admins can add members
    if (userRole !== "OWNER" && userRole !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    // Only owners can create admins
    await protectAuthRequest("member-create", request.headers, session.user.id);
    const body = await readAuthJson(request);
    const validation = createMemberSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { email, fullName, jobTitle, department, role } = validation.data;
    const normalizedEmail = email.toLowerCase();

    // Only owners can add admins or managers
    if ((role === "ADMIN" || role === "MANAGER") && userRole !== "OWNER") {
      return apiError(ApiErrorCode.FORBIDDEN, "Only owners can add admin or manager members");
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        fullName: true, emailVerificationRequired: true, emailVerified: true,
        organizationMemberships: {
          where: { organizationId },
        },
      },
    });

    if (existingUser) {
      // User exists - check if already member of this org
      if (existingUser.organizationMemberships.length > 0) {
        return apiError(ApiErrorCode.CONFLICT, "This user is already a member of your organization");
      }

      requireInvitationEmail();
      const membership = await prisma.organizationMember.create({
        data: { userId: existingUser.id, organizationId, role, status: "PENDING" },
        include: { organization: { select: { name: true } } },
      });
      let invitationSent = true;
      try {
        await sendMemberInvitation({ ...membership, user: existingUser });
      } catch {
        invitationSent = false;
        console.error("Organization invitation email could not be delivered");
      }
      return apiCreated({
        id: membership.id, email: normalizedEmail, name: "Invitation pending",
        role: membership.role, status: membership.status, isNewUser: false, invitationSent,
        message: invitationSent ? "Invitation sent. The recipient must accept before joining." : "Invitation saved, but email delivery failed. Use Resend invitation from the member list.",
      });
    }

    requireInvitationEmail();

    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: null,
          emailVerificationRequired: true,
          emailVerified: false,
          fullName,
          jobTitle: jobTitle || null,
          department: department || null,
        },
      });

      // Create membership
      const membership = await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId,
          role,
          status: "PENDING",
        },
        include: { organization: { select: { name: true } } },
      });

      return { user, membership };
    });

    let invitationSent = true;
    try { await sendMemberInvitation({ ...result.membership, user: result.user }); } catch { invitationSent = false; }
    return apiCreated({
      invitationSent,
      message: invitationSent ? "Invitation sent. The recipient chooses a password and accepts before joining." : "Invitation saved, but email delivery failed. Resend from the member list.",
      id: result.membership.id,
      userId: result.user.id,
      email: result.user.email,
      name: result.user.fullName,
      role: result.membership.role,
      status: result.membership.status,
      isNewUser: true,
    });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Error creating member");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create member");
  }
}
