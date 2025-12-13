import { prisma } from "@/lib/prisma";

export interface DomainDistribution {
  name: string;
  slug: string;
  count: number;
  percentage: number;
  members: string[];
}

export interface ThemeFrequency {
  name: string;
  domain: string;
  count: number;
  members: string[];
}

export interface TeamMemberSummary {
  memberId: string;
  name: string;
  jobTitle?: string;
  topStrengths: string[];
  allStrengths: { name: string; rank: number; domain: string }[];
  dominantDomain: string | null;
}

export interface TeamGap {
  domain: string;
  gapType: "underrepresented" | "missing";
  themes: string[];
  recommendation: string;
}

export interface TeamContext {
  organizationId: string;
  organizationName: string;
  memberCount: number;
  membersWithStrengths: number;
  domainDistribution: DomainDistribution[];
  topThemes: ThemeFrequency[];
  underrepresentedThemes: string[];
  gaps: TeamGap[];
  members: TeamMemberSummary[];
  recentActivity: {
    shoutoutsThisMonth: number;
    skillRequestsThisMonth: number;
    activeChallenges: number;
  };
}

// Build context about a team/organization for AI prompts
export async function buildTeamContext(organizationId: string): Promise<TeamContext | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: {
        where: { status: "ACTIVE" },
        include: {
          user: {
            select: { fullName: true, jobTitle: true },
          },
          strengths: {
            include: {
              theme: {
                include: {
                  domain: { select: { name: true, slug: true } },
                },
              },
            },
            orderBy: { rank: "asc" },
          },
        },
      },
    },
  });

  if (!organization) {
    return null;
  }

  // Get all domains for gap analysis
  const allDomains = await prisma.strengthDomain.findMany({
    include: {
      themes: {
        select: { name: true, slug: true },
      },
    },
  });

  // Calculate domain distribution
  const domainCounts: Record<string, { count: number; members: string[] }> = {};
  const themeCounts: Record<string, { domain: string; count: number; members: string[] }> = {};
  const memberSummaries: TeamMemberSummary[] = [];

  for (const member of organization.members) {
    if (member.strengths.length === 0) continue;

    const memberDomainCounts: Record<string, number> = {};
    const topStrengths: string[] = [];
    const allStrengths: { name: string; rank: number; domain: string }[] = [];

    for (const strength of member.strengths) {
      const domainName = strength.theme.domain.name;
      const domainSlug = strength.theme.domain.slug;
      const themeName = strength.theme.name;

      // Count domains (only for top 5 for distribution analysis)
      if (strength.rank <= 5) {
        if (!domainCounts[domainSlug]) {
          domainCounts[domainSlug] = { count: 0, members: [] };
        }
        domainCounts[domainSlug].count++;
        if (!domainCounts[domainSlug].members.includes(member.user.fullName)) {
          domainCounts[domainSlug].members.push(member.user.fullName);
        }
        memberDomainCounts[domainName] = (memberDomainCounts[domainName] || 0) + 1;

        // Count themes (only top 5 for team analysis)
        if (!themeCounts[themeName]) {
          themeCounts[themeName] = { domain: domainName, count: 0, members: [] };
        }
        themeCounts[themeName].count++;
        if (!themeCounts[themeName].members.includes(member.user.fullName)) {
          themeCounts[themeName].members.push(member.user.fullName);
        }

        topStrengths.push(themeName);
      }

      // Add all strengths with full details
      allStrengths.push({
        name: themeName,
        rank: strength.rank,
        domain: domainName,
      });
    }

    // Determine dominant domain for member
    const dominantDomain =
      Object.entries(memberDomainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    memberSummaries.push({
      memberId: member.id,
      name: member.user.fullName,
      jobTitle: member.user.jobTitle || undefined,
      topStrengths,
      allStrengths,
      dominantDomain,
    });
  }

  // Calculate domain distribution with percentages
  const totalDomainOccurrences = Object.values(domainCounts).reduce(
    (sum, d) => sum + d.count,
    0
  );

  const domainDistribution: DomainDistribution[] = allDomains.map((domain) => ({
    name: domain.name,
    slug: domain.slug,
    count: domainCounts[domain.slug]?.count || 0,
    percentage:
      totalDomainOccurrences > 0
        ? Math.round(
            ((domainCounts[domain.slug]?.count || 0) / totalDomainOccurrences) * 100
          )
        : 0,
    members: domainCounts[domain.slug]?.members || [],
  }));

  // Get top themes (most common across team)
  const topThemes: ThemeFrequency[] = Object.entries(themeCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([name, data]) => ({
      name,
      domain: data.domain,
      count: data.count,
      members: data.members,
    }));

  // Find underrepresented themes (themes no one has)
  const allThemeNames = allDomains.flatMap((d) => d.themes.map((t) => t.name));
  const underrepresentedThemes = allThemeNames.filter(
    (name) => !themeCounts[name] || themeCounts[name].count === 0
  );

  // Identify gaps
  const gaps: TeamGap[] = [];

  // Check for domain gaps
  for (const domain of domainDistribution) {
    if (domain.percentage < 15 && domain.count > 0) {
      gaps.push({
        domain: domain.name,
        gapType: "underrepresented",
        themes: underrepresentedThemes.filter((t) => {
          const d = allDomains.find((ad) => ad.themes.some((th) => th.name === t));
          return d?.slug === domain.slug;
        }),
        recommendation: `Consider developing ${domain.name} capabilities or hiring team members with these strengths.`,
      });
    } else if (domain.percentage === 0) {
      gaps.push({
        domain: domain.name,
        gapType: "missing",
        themes: allDomains.find((d) => d.slug === domain.slug)?.themes.map((t) => t.name) || [],
        recommendation: `The team has no representation in ${domain.name}. This could impact ${getImpactDescription(domain.slug)}.`,
      });
    }
  }

  // Get recent activity
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [shoutoutsThisMonth, skillRequestsThisMonth, activeChallenges] = await Promise.all([
    prisma.shoutout.count({
      where: {
        organizationId,
        createdAt: { gte: startOfMonth },
      },
    }),
    prisma.skillRequest.count({
      where: {
        organizationId,
        createdAt: { gte: startOfMonth },
      },
    }),
    prisma.teamChallenge.count({
      where: {
        organizationId,
        status: "ACTIVE",
      },
    }),
  ]);

  const membersWithStrengths = organization.members.filter(
    (m) => m.strengths.length > 0
  ).length;

  return {
    organizationId,
    organizationName: organization.name,
    memberCount: organization.members.length,
    membersWithStrengths,
    domainDistribution,
    topThemes,
    underrepresentedThemes,
    gaps,
    members: memberSummaries,
    recentActivity: {
      shoutoutsThisMonth,
      skillRequestsThisMonth,
      activeChallenges,
    },
  };
}

// Helper function to describe impact of missing domains
function getImpactDescription(domainSlug: string): string {
  switch (domainSlug) {
    case "executing":
      return "task completion and follow-through";
    case "influencing":
      return "communication and driving action";
    case "relationship":
      return "team cohesion and collaboration";
    case "strategic":
      return "planning and long-term thinking";
    default:
      return "team effectiveness";
  }
}

// Format team context for AI prompts
export function formatTeamContextForPrompt(context: TeamContext): string {
  const lines: string[] = [];

  lines.push(`**Team: ${context.organizationName}**`);
  lines.push(`Members: ${context.memberCount} (${context.membersWithStrengths} with strengths profiles)`);

  lines.push("\n**Domain Distribution:**");
  for (const domain of context.domainDistribution) {
    lines.push(`- ${domain.name}: ${domain.percentage}% (${domain.count} strengths)`);
  }

  lines.push("\n**Top Strengths Across Team:**");
  for (const theme of context.topThemes.slice(0, 5)) {
    lines.push(`- ${theme.name} (${theme.domain}): ${theme.count} team members`);
  }

  if (context.gaps.length > 0) {
    lines.push("\n**Identified Gaps:**");
    for (const gap of context.gaps) {
      lines.push(`- ${gap.domain}: ${gap.gapType}`);
    }
  }

  lines.push("\n**Recent Activity:**");
  lines.push(`- Shoutouts this month: ${context.recentActivity.shoutoutsThisMonth}`);
  lines.push(`- Skill requests: ${context.recentActivity.skillRequestsThisMonth}`);
  lines.push(`- Active challenges: ${context.recentActivity.activeChallenges}`);

  return lines.join("\n");
}

// Get minimal team context for simple prompts
export async function getMinimalTeamContext(
  organizationId: string
): Promise<{
  name: string;
  memberCount: number;
  topDomains: string[];
  topThemes: string[];
} | null> {
  const context = await buildTeamContext(organizationId);
  if (!context) return null;

  return {
    name: context.organizationName,
    memberCount: context.memberCount,
    topDomains: context.domainDistribution
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 2)
      .map((d) => d.name),
    topThemes: context.topThemes.slice(0, 5).map((t) => t.name),
  };
}

// Get members who have specific strengths
export async function getMembersWithStrengths(
  organizationId: string,
  themeNames: string[]
): Promise<TeamMemberSummary[]> {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      strengths: {
        some: {
          theme: {
            name: { in: themeNames },
          },
          rank: { lte: 10 },
        },
      },
    },
    include: {
      user: {
        select: { fullName: true, jobTitle: true },
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

  return members.map((m) => {
    const domainCounts: Record<string, number> = {};
    for (const s of m.strengths) {
      domainCounts[s.theme.domain.name] = (domainCounts[s.theme.domain.name] || 0) + 1;
    }

    return {
      memberId: m.id,
      name: m.user.fullName,
      jobTitle: m.user.jobTitle || undefined,
      topStrengths: m.strengths.map((s) => s.theme.name),
      allStrengths: m.strengths.map((s) => ({
        name: s.theme.name,
        rank: s.rank,
        domain: s.theme.domain.name,
      })),
      dominantDomain: Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    };
  });
}
