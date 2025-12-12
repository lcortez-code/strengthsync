import { prisma } from "@/lib/prisma";

export interface UserStrengthContext {
  name: string;
  rank: number;
  domain: string;
  domainSlug: string;
  personalizedDescription?: string;
}

export interface UserContext {
  memberId: string;
  userId: string;
  fullName: string;
  jobTitle?: string;
  department?: string;
  bio?: string;
  topStrengths: UserStrengthContext[];
  allStrengths: UserStrengthContext[];
  dominantDomain: string | null;
  badges: string[];
  points: number;
  recentActivity: {
    shoutoutsGiven: number;
    shoutoutsReceived: number;
    skillRequestsHelped: number;
    challengesCompleted: number;
  };
}

// Build context about a user for AI prompts
export async function buildUserContext(memberId: string): Promise<UserContext | null> {
  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          department: true,
          bio: true,
        },
      },
      strengths: {
        include: {
          theme: {
            include: {
              domain: {
                select: { name: true, slug: true },
              },
            },
          },
        },
        orderBy: { rank: "asc" },
      },
      badgesEarned: {
        include: {
          badge: {
            select: { name: true },
          },
        },
      },
    },
  });

  if (!member) {
    return null;
  }

  // Get recent activity (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [shoutoutsGiven, shoutoutsReceived, responsesAccepted, challengesCompleted] =
    await Promise.all([
      prisma.shoutout.count({
        where: {
          giverId: memberId,
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.shoutout.count({
        where: {
          receiverId: memberId,
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.skillRequestResponse.count({
        where: {
          responderId: memberId,
          status: "COMPLETED",
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.challengeParticipant.count({
        where: {
          memberId,
          completedAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

  // Transform strengths
  const allStrengths: UserStrengthContext[] = member.strengths.map((s) => ({
    name: s.theme.name,
    rank: s.rank,
    domain: s.theme.domain.name,
    domainSlug: s.theme.domain.slug,
    personalizedDescription: s.personalizedDescription || undefined,
  }));

  const topStrengths = allStrengths.filter((s) => s.rank <= 5);

  // Calculate dominant domain
  const domainCounts: Record<string, number> = {};
  for (const s of topStrengths) {
    domainCounts[s.domain] = (domainCounts[s.domain] || 0) + 1;
  }
  const dominantDomain =
    Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    memberId,
    userId: member.user.id,
    fullName: member.user.fullName,
    jobTitle: member.user.jobTitle || undefined,
    department: member.user.department || undefined,
    bio: member.user.bio || undefined,
    topStrengths,
    allStrengths,
    dominantDomain,
    badges: member.badgesEarned.map((b) => b.badge.name),
    points: member.points,
    recentActivity: {
      shoutoutsGiven,
      shoutoutsReceived,
      skillRequestsHelped: responsesAccepted,
      challengesCompleted,
    },
  };
}

// Format user context as a string for AI prompts
export function formatUserContextForPrompt(context: UserContext): string {
  const lines: string[] = [];

  lines.push(`**${context.fullName}**`);
  if (context.jobTitle) {
    lines.push(`Role: ${context.jobTitle}`);
  }
  if (context.department) {
    lines.push(`Department: ${context.department}`);
  }

  if (context.topStrengths.length > 0) {
    lines.push("\nTop 5 CliftonStrengths:");
    for (const strength of context.topStrengths) {
      const desc = strength.personalizedDescription
        ? ` - ${strength.personalizedDescription.substring(0, 100)}...`
        : "";
      lines.push(`${strength.rank}. ${strength.name} (${strength.domain})${desc}`);
    }
  }

  if (context.dominantDomain) {
    lines.push(`\nDominant Domain: ${context.dominantDomain}`);
  }

  if (context.badges.length > 0) {
    lines.push(`\nBadges: ${context.badges.join(", ")}`);
  }

  lines.push(`Points: ${context.points}`);

  const activity = context.recentActivity;
  lines.push("\nRecent Activity (30 days):");
  lines.push(`- Shoutouts given: ${activity.shoutoutsGiven}`);
  lines.push(`- Shoutouts received: ${activity.shoutoutsReceived}`);
  lines.push(`- Skill requests helped: ${activity.skillRequestsHelped}`);
  lines.push(`- Challenges completed: ${activity.challengesCompleted}`);

  return lines.join("\n");
}

// Get minimal context for simple prompts
export async function getMinimalUserContext(
  memberId: string
): Promise<{ name: string; topStrengths: string[]; dominantDomain: string | null } | null> {
  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    include: {
      user: {
        select: { fullName: true },
      },
      strengths: {
        where: { rank: { lte: 5 } },
        include: {
          theme: {
            include: {
              domain: { select: { name: true } },
            },
          },
        },
        orderBy: { rank: "asc" },
      },
    },
  });

  if (!member) {
    return null;
  }

  const domainCounts: Record<string, number> = {};
  for (const s of member.strengths) {
    domainCounts[s.theme.domain.name] = (domainCounts[s.theme.domain.name] || 0) + 1;
  }
  const dominantDomain =
    Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    name: member.user.fullName,
    topStrengths: member.strengths.map((s) => s.theme.name),
    dominantDomain,
  };
}
