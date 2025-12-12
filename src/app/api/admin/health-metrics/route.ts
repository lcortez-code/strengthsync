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

    const isAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
    if (!isAdmin) {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch all metrics in parallel
    const [
      totalMembers,
      membersWithStrengths,
      shoutoutsThisWeek,
      shoutoutsLastWeek,
      activeUsersThisWeek,
      activeUsersLastWeek,
      activeChallenges,
      challengeParticipants,
      activeMentorships,
      mentorshipRequestsThisMonth,
      topContributors,
      domainDistribution,
    ] = await Promise.all([
      // Total members
      prisma.organizationMember.count({
        where: { organizationId, status: "ACTIVE" },
      }),

      // Members with strengths
      prisma.organizationMember.count({
        where: {
          organizationId,
          status: "ACTIVE",
          strengths: { some: {} },
        },
      }),

      // Shoutouts this week
      prisma.shoutout.count({
        where: {
          giver: { organizationId },
          createdAt: { gte: oneWeekAgo },
        },
      }),

      // Shoutouts last week
      prisma.shoutout.count({
        where: {
          giver: { organizationId },
          createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
        },
      }),

      // Active users this week (based on shoutouts given/received or feed activity)
      prisma.organizationMember.count({
        where: {
          organizationId,
          status: "ACTIVE",
          OR: [
            { shoutoutsGiven: { some: { createdAt: { gte: oneWeekAgo } } } },
            { shoutoutsReceived: { some: { createdAt: { gte: oneWeekAgo } } } },
          ],
        },
      }),

      // Active users last week
      prisma.organizationMember.count({
        where: {
          organizationId,
          status: "ACTIVE",
          OR: [
            { shoutoutsGiven: { some: { createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } } },
            { shoutoutsReceived: { some: { createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } } },
          ],
        },
      }),

      // Active challenges
      prisma.teamChallenge.count({
        where: {
          organizationId,
          status: "ACTIVE",
        },
      }),

      // Challenge participants
      prisma.challengeParticipant.count({
        where: {
          challenge: { organizationId, status: "ACTIVE" },
        },
      }),

      // Active mentorships
      prisma.mentorship.count({
        where: {
          mentor: { organizationId },
          status: "ACTIVE",
        },
      }),

      // Mentorship requests this month
      prisma.mentorship.count({
        where: {
          mentor: { organizationId },
          startedAt: { gte: oneMonthAgo },
        },
      }),

      // Top contributors
      prisma.organizationMember.findMany({
        where: { organizationId, status: "ACTIVE" },
        select: {
          id: true,
          points: true,
          user: { select: { fullName: true } },
          _count: {
            select: {
              shoutoutsGiven: true,
              shoutoutsReceived: true,
            },
          },
        },
        orderBy: { points: "desc" },
        take: 5,
      }),

      // Domain distribution
      prisma.memberStrength.groupBy({
        by: ["themeId"],
        where: {
          member: { organizationId, status: "ACTIVE" },
          rank: { lte: 5 },
        },
        _count: { themeId: true },
      }),
    ]);

    // Calculate domain percentages from theme distribution
    const themes = await prisma.strengthTheme.findMany({
      select: { id: true, domain: { select: { slug: true } } },
    });

    const themeIdToDomain: Record<string, string> = {};
    themes.forEach((t) => {
      themeIdToDomain[t.id] = t.domain.slug;
    });

    const domainCounts: Record<string, number> = {
      executing: 0,
      influencing: 0,
      relationship: 0,
      strategic: 0,
    };

    let totalDomainCount = 0;
    domainDistribution.forEach((d) => {
      const domain = themeIdToDomain[d.themeId];
      if (domain && domainCounts[domain] !== undefined) {
        domainCounts[domain] += d._count.themeId;
        totalDomainCount += d._count.themeId;
      }
    });

    const domainBalance = Object.entries(domainCounts).map(([domain, count]) => ({
      domain: domain as "executing" | "influencing" | "relationship" | "strategic",
      percentage: totalDomainCount > 0 ? Math.round((count / totalDomainCount) * 100) : 25,
    }));

    // Calculate trends
    const shoutoutsTrend = shoutoutsLastWeek > 0
      ? Math.round(((shoutoutsThisWeek - shoutoutsLastWeek) / shoutoutsLastWeek) * 100)
      : shoutoutsThisWeek > 0 ? 100 : 0;

    const engagementTrend = activeUsersLastWeek > 0
      ? Math.round(((activeUsersThisWeek - activeUsersLastWeek) / activeUsersLastWeek) * 100)
      : activeUsersThisWeek > 0 ? 100 : 0;

    // Generate alerts
    const alerts: { type: "warning" | "info" | "success"; message: string }[] = [];

    const strengthsUploadRate = totalMembers > 0 ? Math.round((membersWithStrengths / totalMembers) * 100) : 0;

    if (strengthsUploadRate < 50) {
      alerts.push({
        type: "warning",
        message: `Only ${strengthsUploadRate}% of team members have uploaded strengths. Consider encouraging more uploads.`,
      });
    }

    if (shoutoutsThisWeek === 0 && totalMembers > 2) {
      alerts.push({
        type: "warning",
        message: "No shoutouts given this week. Recognition helps build team morale!",
      });
    }

    if (shoutoutsTrend > 20) {
      alerts.push({
        type: "success",
        message: `Recognition up ${shoutoutsTrend}% this week! Great engagement.`,
      });
    }

    if (activeChallenges === 0 && totalMembers > 5) {
      alerts.push({
        type: "info",
        message: "No active challenges. Consider starting one to boost engagement.",
      });
    }

    // Challenge participation rate
    const challengeParticipationRate = totalMembers > 0 && activeChallenges > 0
      ? Math.round((challengeParticipants / totalMembers) * 100)
      : 0;

    // Average shoutouts per member
    const avgShoutoutsPerMember = totalMembers > 0
      ? (shoutoutsThisWeek + shoutoutsLastWeek) / totalMembers
      : 0;

    const response = {
      totalMembers,
      membersWithStrengths,
      strengthsUploadRate,
      activeUsersThisWeek,
      activeUsersLastWeek,
      engagementTrend,
      shoutoutsThisWeek,
      shoutoutsLastWeek,
      shoutoutsTrend,
      avgShoutoutsPerMember,
      activeChallenges,
      challengeParticipationRate,
      activeMentorships,
      mentorshipRequestsThisMonth,
      topContributors: topContributors.map((m) => ({
        id: m.id,
        name: m.user.fullName || "Unknown",
        points: m.points,
        shoutoutsGiven: m._count.shoutoutsGiven,
        shoutoutsReceived: m._count.shoutoutsReceived,
      })),
      domainBalance,
      alerts,
    };

    return apiSuccess(response);
  } catch (error) {
    console.error("[Health Metrics Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch health metrics");
  }
}
