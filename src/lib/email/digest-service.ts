/**
 * Weekly Digest Data Aggregation Service
 * Fetches all data needed to generate a user's weekly digest email
 */

import { prisma } from "@/lib/prisma";
import { generate, checkAIReady } from "@/lib/ai";
import { buildUserContext } from "@/lib/ai/context/user-context";
import type { WeeklyDigestData } from "./templates/weekly-digest";

interface DigestRecipient {
  userId: string;
  userEmail: string;
  userName: string;
  memberId: string;
  organizationId: string;
  organizationName: string;
}

/**
 * Get all users eligible for weekly digest
 */
export async function getDigestRecipients(): Promise<DigestRecipient[]> {
  const members = await prisma.organizationMember.findMany({
    where: {
      status: "ACTIVE",
      user: {
        emailVerified: true,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          preferences: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Filter out users who have disabled digest emails
  return members
    .filter((m) => {
      const prefs = m.user.preferences as Record<string, unknown> | null;
      // Default to enabled if no preference set
      return prefs?.weeklyDigestEnabled !== false;
    })
    .map((m) => ({
      userId: m.user.id,
      userEmail: m.user.email,
      userName: m.user.fullName,
      memberId: m.id,
      organizationId: m.organization.id,
      organizationName: m.organization.name,
    }));
}

/**
 * Get a single user's weekly digest data
 */
export async function getUserDigestData(
  userId: string,
  memberId: string,
  organizationId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<Omit<WeeklyDigestData, "userEmail" | "unsubscribeUrl">> {
  const appUrl = process.env.NEXTAUTH_URL || "https://strengthsync.app";

  // Fetch member data
  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    include: {
      user: {
        select: {
          fullName: true,
        },
      },
      organization: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!member) {
    throw new Error(`Member ${memberId} not found`);
  }

  // Fetch shoutouts received this week
  const shoutoutsReceivedRaw = await prisma.shoutout.findMany({
    where: {
      receiverId: memberId,
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    include: {
      giver: {
        include: {
          user: {
            select: {
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      },
      theme: {
        include: {
          domain: {
            select: {
              slug: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 5, // Limit to 5 most recent for email
  });

  const shoutoutsReceived = shoutoutsReceivedRaw.map((s) => ({
    id: s.id,
    giverName: s.giver.user.fullName,
    giverAvatarUrl: s.giver.user.avatarUrl || undefined,
    themeName: s.theme?.name,
    domainSlug: s.theme?.domain.slug,
    message: s.message.length > 200 ? s.message.substring(0, 200) + "..." : s.message,
    createdAt: s.createdAt.toISOString(),
  }));

  // Count shoutouts given this week
  const shoutoutsGiven = await prisma.shoutout.count({
    where: {
      giverId: memberId,
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
  });

  // Calculate points earned this week
  // Points from shoutouts given: 5 each
  // Points from shoutouts received: 10 each
  // Points from skill request responses: 15 each
  // Points from accepted responses: 25 each
  const shoutoutsGivenPoints = shoutoutsGiven * 5;
  const shoutoutsReceivedPoints = shoutoutsReceivedRaw.length * 10;

  const skillResponsesCount = await prisma.skillRequestResponse.count({
    where: {
      responderId: memberId,
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
  });

  const acceptedResponsesCount = await prisma.skillRequestResponse.count({
    where: {
      responderId: memberId,
      status: "ACCEPTED",
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
  });

  const pointsEarned =
    shoutoutsGivenPoints +
    shoutoutsReceivedPoints +
    skillResponsesCount * 15 +
    acceptedResponsesCount * 25;

  // Get badges earned this week
  const badgesEarnedRaw = await prisma.badgeEarned.findMany({
    where: {
      memberId: memberId,
      earnedAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    include: {
      badge: true,
    },
  });

  const badgesEarned = badgesEarnedRaw.map((b) => ({
    name: b.badge.name,
    description: b.badge.description,
    iconUrl: b.badge.iconUrl,
    earnedAt: b.earnedAt.toISOString(),
  }));

  // Get active challenges
  const activeChallengesRaw = await prisma.challengeParticipant.findMany({
    where: {
      memberId: memberId,
      challenge: {
        status: "ACTIVE",
        organizationId: organizationId,
      },
    },
    include: {
      challenge: true,
    },
  });

  const activeChallenges = activeChallengesRaw.map((cp) => {
    const progress = cp.progress as Record<string, unknown> | null;
    let progressPercent = 0;

    // Calculate progress based on challenge type
    if (cp.challenge.challengeType === "STRENGTHS_BINGO") {
      const markedCells = (progress?.markedCells as string[]) || [];
      progressPercent = Math.round((markedCells.length / 25) * 100);
    } else {
      progressPercent = (progress?.percentComplete as number) || 0;
    }

    return {
      name: cp.challenge.name,
      type: cp.challenge.challengeType,
      progress: progressPercent,
      endsAt: cp.challenge.endsAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    };
  });

  // Get leaderboard position
  const allMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: organizationId,
      status: "ACTIVE",
    },
    include: {
      user: {
        select: {
          fullName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: {
      points: "desc",
    },
    take: 5,
  });

  const userRankResult = await prisma.$queryRaw<{ rank: bigint }[]>`
    SELECT rank FROM (
      SELECT id, RANK() OVER (ORDER BY points DESC) as rank
      FROM organization_members
      WHERE organization_id = ${organizationId} AND status = 'ACTIVE'
    ) ranked
    WHERE id = ${memberId}
  `;

  const userRank =
    userRankResult.length > 0 ? Number(userRankResult[0].rank) : undefined;

  const topContributors = allMembers.map((m, idx) => ({
    name: m.user.fullName,
    avatarUrl: m.user.avatarUrl || undefined,
    points: m.points,
    rank: idx + 1,
  }));

  // Generate suggested actions
  const suggestedActions: string[] = [];

  if (shoutoutsGiven === 0) {
    suggestedActions.push(
      "Send a shoutout to recognize a teammate's strengths this week"
    );
  }

  if (activeChallenges.length === 0) {
    suggestedActions.push(
      "Join an active challenge to earn bonus points and connect with teammates"
    );
  }

  const hasMentorship = await prisma.mentorship.count({
    where: {
      OR: [{ mentorId: memberId }, { menteeId: memberId }],
      status: "ACTIVE",
    },
  });

  if (hasMentorship === 0) {
    suggestedActions.push(
      "Explore mentorship matches to grow through strengths-based partnerships"
    );
  }

  if (badgesEarned.length === 0 && pointsEarned > 0) {
    suggestedActions.push(
      "Keep up the momentum! You're making progress toward your next badge"
    );
  }

  // Get badge progress (find closest badge not yet earned)
  const earnedBadgeIds = await prisma.badgeEarned.findMany({
    where: { memberId },
    select: { badgeId: true },
  });

  const earnedIds = earnedBadgeIds.map((b) => b.badgeId);

  const nextBadge = await prisma.badge.findFirst({
    where: {
      id: { notIn: earnedIds },
      category: "SHOUTOUT", // Focus on shoutout badges as most common
    },
    orderBy: {
      points: "asc",
    },
  });

  let badgeProgress: WeeklyDigestData["badgeProgress"] = undefined;

  if (nextBadge) {
    const requirement = nextBadge.requirement as Record<string, number> | null;
    const requiredCount = requirement?.count || 10;
    const totalShoutoutsGiven = await prisma.shoutout.count({
      where: { giverId: memberId },
    });

    if (totalShoutoutsGiven < requiredCount) {
      badgeProgress = {
        badgeName: nextBadge.name,
        current: totalShoutoutsGiven,
        required: requiredCount,
      };
    }
  }

  return {
    userName: member.user.fullName,
    organizationName: member.organization.name,
    periodStart,
    periodEnd,
    shoutoutsReceived,
    shoutoutsGiven,
    pointsEarned,
    totalPoints: member.points,
    currentStreak: member.streak,
    badgesEarned,
    badgeProgress,
    activeChallenges,
    userRank,
    topContributors,
    suggestedActions,
    appUrl,
  };
}

/**
 * Check if a digest was already sent for this period
 */
export async function wasDigestSent(
  userId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<boolean> {
  const existing = await prisma.emailDigestLog.findFirst({
    where: {
      userId,
      digestType: "WEEKLY",
      periodStart,
      periodEnd,
      status: "SENT",
    },
  });

  return !!existing;
}

/**
 * Get the date range for the current week's digest
 * Week runs Monday to Sunday
 */
export function getWeeklyDigestPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();

  // Calculate days since last Monday
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  // Last Monday at 00:00:00 UTC
  const start = new Date(now);
  start.setUTCDate(now.getUTCDate() - daysSinceMonday - 7);
  start.setUTCHours(0, 0, 0, 0);

  // Last Sunday at 23:59:59 UTC
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Generate an AI-powered personalized narrative for the weekly digest
 */
export async function generateDigestNarrative(
  memberId: string,
  organizationId: string,
  digestData: Omit<WeeklyDigestData, "userEmail" | "unsubscribeUrl" | "aiNarrative">
): Promise<string | null> {
  // Check if AI is configured
  const aiReady = checkAIReady();
  if (!aiReady.ready) {
    console.log("[Digest AI] Skipping narrative - AI not configured");
    return null;
  }

  // Get user context for strengths info
  const userContext = await buildUserContext(memberId);
  if (!userContext || userContext.topStrengths.length === 0) {
    console.log("[Digest AI] Skipping narrative - no strengths profile");
    return null;
  }

  // Build activity summary
  const activityPoints: string[] = [];

  if (digestData.shoutoutsReceived.length > 0) {
    const themes = [...new Set(digestData.shoutoutsReceived.map(s => s.themeName).filter(Boolean))];
    activityPoints.push(
      `Received ${digestData.shoutoutsReceived.length} shoutout(s)${themes.length > 0 ? ` highlighting ${themes.join(", ")}` : ""}`
    );
  }

  if (digestData.shoutoutsGiven > 0) {
    activityPoints.push(`Gave ${digestData.shoutoutsGiven} shoutout(s) to teammates`);
  }

  if (digestData.badgesEarned.length > 0) {
    activityPoints.push(`Earned ${digestData.badgesEarned.length} badge(s): ${digestData.badgesEarned.map(b => b.name).join(", ")}`);
  }

  if (digestData.activeChallenges.length > 0) {
    const avgProgress = Math.round(
      digestData.activeChallenges.reduce((sum, c) => sum + c.progress, 0) / digestData.activeChallenges.length
    );
    activityPoints.push(`Active in ${digestData.activeChallenges.length} challenge(s) (${avgProgress}% average progress)`);
  }

  // Skip if minimal activity
  if (activityPoints.length === 0 && digestData.pointsEarned === 0) {
    return null;
  }

  const systemPrompt = `You are a friendly CliftonStrengths coach writing a brief, personalized weekly summary for an email digest.

Your tone should be:
- Warm and encouraging, like a supportive coach
- Specific to their strengths and activities
- Concise (2-3 sentences maximum)
- Motivating without being over-the-top

Do NOT use:
- Generic platitudes
- Bullet points or formatting
- More than 3 sentences`;

  const userPrompt = `Write a brief personalized weekly summary for ${digestData.userName}.

**Their Top Strengths:**
${userContext.topStrengths.map((s, i) => `${i + 1}. ${s.name} (${s.domain})`).join("\n")}

**This Week's Activity:**
${activityPoints.length > 0 ? activityPoints.join("\n") : "No recorded activity this week"}
Points earned: ${digestData.pointsEarned}
Current streak: ${digestData.currentStreak} days

**Leaderboard Position:** ${digestData.userRank ? `#${digestData.userRank}` : "Not ranked"}

Write 2-3 sentences that:
1. Acknowledge their specific activity (if any) and connect it to their strengths
2. Offer brief encouragement for the week ahead`;

  try {
    const result = await generate({
      memberId,
      organizationId,
      feature: "generate-bio", // Reuse similar settings
      prompt: userPrompt,
      systemPrompt,
      temperature: 0.8,
      maxTokens: 200,
    });

    if (!result.success || !result.data) {
      console.error("[Digest AI] Generation failed:", result.error);
      return null;
    }

    console.log(`[Digest AI] Generated narrative for ${memberId}`);
    return result.data;
  } catch (error) {
    console.error("[Digest AI] Error generating narrative:", error);
    return null;
  }
}
