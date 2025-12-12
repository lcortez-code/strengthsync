import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const member = await prisma.organizationMember.findFirst({
      where: {
        id: memberId,
        organizationId,
      },
      include: {
        user: {
          select: {
            fullName: true,
            avatarUrl: true,
            jobTitle: true,
            department: true,
            bio: true,
          },
        },
        strengths: {
          include: {
            theme: {
              include: {
                domain: { select: { slug: true, name: true, colorHex: true } },
              },
            },
          },
          orderBy: { rank: "asc" },
        },
        badgesEarned: {
          include: {
            badge: { select: { name: true, iconUrl: true, tier: true } },
          },
          orderBy: { earnedAt: "desc" },
          take: 5,
        },
        shoutoutsReceived: {
          take: 1,
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            shoutoutsReceived: true,
            shoutoutsGiven: true,
            mentorshipsAsMentor: true,
            mentorshipsAsMentee: true,
          },
        },
      },
    });

    if (!member) {
      return apiError(ApiErrorCode.NOT_FOUND, "Member not found");
    }

    // Calculate domain distribution
    const domainCounts: Record<string, number> = {};
    member.strengths.slice(0, 10).forEach((s) => {
      const domain = s.theme.domain.slug;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    });

    // Find primary domain (most represented in top 10)
    let primaryDomain = "strategic";
    let maxCount = 0;
    Object.entries(domainCounts).forEach(([domain, count]) => {
      if (count > maxCount) {
        maxCount = count;
        primaryDomain = domain;
      }
    });

    // Get domain color for primary domain
    const primaryDomainData = member.strengths.find(
      (s) => s.theme.domain.slug === primaryDomain
    )?.theme.domain;

    return apiSuccess({
      id: member.id,
      name: member.user.fullName,
      avatarUrl: member.user.avatarUrl,
      jobTitle: member.user.jobTitle,
      department: member.user.department,
      bio: member.user.bio,
      primaryDomain: {
        slug: primaryDomain,
        name: primaryDomainData?.name || primaryDomain,
        colorHex: primaryDomainData?.colorHex || "#7CB342",
      },
      domainDistribution: domainCounts,
      topStrengths: member.strengths.slice(0, 5).map((s) => ({
        rank: s.rank,
        name: s.theme.name,
        domain: s.theme.domain.slug,
        domainColor: s.theme.domain.colorHex,
        description: s.theme.shortDescription,
      })),
      allStrengths: member.strengths.map((s) => ({
        rank: s.rank,
        name: s.theme.name,
        domain: s.theme.domain.slug,
      })),
      stats: {
        shoutoutsReceived: member._count.shoutoutsReceived,
        shoutoutsGiven: member._count.shoutoutsGiven,
        mentorshipsAsMentor: member._count.mentorshipsAsMentor,
        mentorshipsAsMentee: member._count.mentorshipsAsMentee,
        points: member.points,
        streak: member.streak,
      },
      badges: member.badgesEarned.map((be) => ({
        name: be.badge.name,
        iconUrl: be.badge.iconUrl,
        tier: be.badge.tier,
        earnedAt: be.earnedAt.toISOString(),
      })),
      joinedAt: member.joinedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error fetching card data:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch card data");
  }
}
