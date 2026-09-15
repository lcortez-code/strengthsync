import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { canViewFullProfile } from "@/lib/auth/permissions";
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

    const fullProfile = canViewFullProfile({
      viewerRole: session.user.role,
      viewerMemberId: session.user.memberId,
      targetMemberId: memberId,
    });
    const member = await prisma.organizationMember.findFirst({
      where: {
        id: memberId,
        organizationId,
        status: "ACTIVE",
      },
      include: {
        user: {
          select: {
            fullName: true,
            avatarUrl: true,
            jobTitle: true,
            department: true,
            bio: fullProfile,
          },
        },
        strengths: {
          where: fullProfile ? undefined : { rank: { lte: 5 } },
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
    member.strengths.filter((s) => s.rank <= (fullProfile ? 10 : 5)).forEach((s) => {
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
      bio: fullProfile ? member.user.bio : null,
      isFullProfile: fullProfile,
      primaryDomain: {
        slug: primaryDomain,
        name: primaryDomainData?.name || primaryDomain,
        colorHex: primaryDomainData?.colorHex || "#7CB342",
      },
      domainDistribution: domainCounts,
      topStrengths: member.strengths.filter((s) => s.rank <= 5).map((s) => ({
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
      stats: fullProfile ? {
        shoutoutsReceived: member._count.shoutoutsReceived,
        shoutoutsGiven: member._count.shoutoutsGiven,
        mentorshipsAsMentor: member._count.mentorshipsAsMentor,
        mentorshipsAsMentee: member._count.mentorshipsAsMentee,
        points: member.points,
        streak: member.streak,
      } : null,
      badges: fullProfile ? member.badgesEarned.map((be) => ({
        name: be.badge.name,
        iconUrl: be.badge.iconUrl,
        tier: be.badge.tier,
        earnedAt: be.earnedAt.toISOString(),
      })) : [],
      joinedAt: fullProfile ? member.joinedAt.toISOString() : null,
    });
  } catch (error) {
    console.error("Error fetching card data:");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch card data");
  }
}
