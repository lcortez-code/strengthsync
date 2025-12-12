import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { THEMES, DOMAINS } from "@/constants/strengths-data";

// Tool parameter schemas
export const searchMembersSchema = z.object({
  query: z.string().describe("The strength theme name, domain name, or search term"),
  limit: z.number().optional().default(5).describe("Maximum number of results to return"),
});

export const getTeamCompositionSchema = z.object({});

export const explainStrengthSchema = z.object({
  themeName: z.string().describe("The name of the strength theme to explain"),
});

export const suggestPartnersSchema = z.object({
  memberId: z.string().describe("The ID of the member to find partners for"),
  limit: z.number().optional().default(3).describe("Maximum number of suggestions"),
});

// Tool execution functions
export async function executeSearchMembers(
  params: z.infer<typeof searchMembersSchema>,
  organizationId: string
) {
  const { query, limit = 5 } = params;
  const lowercaseQuery = query.toLowerCase();

  // Check if it's a domain search
  const domain = DOMAINS.find(
    (d) => d.name.toLowerCase().includes(lowercaseQuery) || d.slug === lowercaseQuery
  );

  // Check if it's a theme search
  const theme = THEMES.find(
    (t) => t.name.toLowerCase().includes(lowercaseQuery) || t.slug === lowercaseQuery
  );

  let members;

  if (domain) {
    members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        strengths: {
          some: {
            theme: { domain: { slug: domain.slug } },
            rank: { lte: 10 },
          },
        },
      },
      include: {
        user: { select: { fullName: true, jobTitle: true } },
        strengths: {
          where: { rank: { lte: 5 } },
          include: { theme: { include: { domain: true } } },
          orderBy: { rank: "asc" },
        },
      },
      take: limit,
    });
  } else if (theme) {
    members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        strengths: {
          some: {
            theme: { slug: theme.slug },
            rank: { lte: 10 },
          },
        },
      },
      include: {
        user: { select: { fullName: true, jobTitle: true } },
        strengths: {
          where: { rank: { lte: 5 } },
          include: { theme: { include: { domain: true } } },
          orderBy: { rank: "asc" },
        },
      },
      take: limit,
    });
  } else {
    members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        user: { fullName: { contains: query, mode: "insensitive" } },
      },
      include: {
        user: { select: { fullName: true, jobTitle: true } },
        strengths: {
          where: { rank: { lte: 5 } },
          include: { theme: { include: { domain: true } } },
          orderBy: { rank: "asc" },
        },
      },
      take: limit,
    });
  }

  return {
    searchType: domain ? "domain" : theme ? "theme" : "name",
    query,
    results: members.map((m) => ({
      id: m.id,
      name: m.user.fullName,
      jobTitle: m.user.jobTitle,
      topStrengths: m.strengths.map((s) => ({
        name: s.theme.name,
        domain: s.theme.domain.name,
        rank: s.rank,
      })),
    })),
    count: members.length,
  };
}

export async function executeGetTeamComposition(organizationId: string) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      strengths: {
        where: { rank: { lte: 5 } },
        include: { theme: { include: { domain: true } } },
      },
    },
  });

  const domainCounts: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};

  for (const member of members) {
    for (const strength of member.strengths) {
      const domainName = strength.theme.domain.name;
      const themeName = strength.theme.name;
      domainCounts[domainName] = (domainCounts[domainName] || 0) + 1;
      themeCounts[themeName] = (themeCounts[themeName] || 0) + 1;
    }
  }

  const totalStrengths = Object.values(domainCounts).reduce((a, b) => a + b, 0);

  return {
    memberCount: members.length,
    membersWithStrengths: members.filter((m) => m.strengths.length > 0).length,
    domainDistribution: Object.entries(domainCounts)
      .map(([name, count]) => ({
        domain: name,
        count,
        percentage: totalStrengths > 0 ? Math.round((count / totalStrengths) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count),
    topThemes: Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ theme: name, count })),
  };
}

export async function executeExplainStrength(params: z.infer<typeof explainStrengthSchema>) {
  const { themeName } = params;

  const theme = await prisma.strengthTheme.findFirst({
    where: {
      OR: [
        { name: { equals: themeName, mode: "insensitive" } },
        { slug: { equals: themeName.toLowerCase().replace(/\s+/g, "-") } },
      ],
    },
    include: { domain: true },
  });

  if (!theme) {
    const constTheme = THEMES.find(
      (t) =>
        t.name.toLowerCase() === themeName.toLowerCase() ||
        t.slug === themeName.toLowerCase()
    );

    if (constTheme) {
      const domain = DOMAINS.find((d) => d.slug === constTheme.domain);
      return {
        name: constTheme.name,
        domain: domain?.name || "Unknown",
        shortDescription: constTheme.shortDescription || "No description available",
        blindSpots: [],
        actionItems: [],
      };
    }

    return { error: `Theme "${themeName}" not found` };
  }

  return {
    name: theme.name,
    domain: theme.domain.name,
    description: theme.fullDescription,
    shortDescription: theme.shortDescription,
    blindSpots: theme.blindSpots,
    actionItems: theme.actionItems,
    worksWith: theme.worksWith,
  };
}

export async function executeSuggestPartners(
  params: z.infer<typeof suggestPartnersSchema>,
  organizationId: string
) {
  const { memberId, limit = 3 } = params;

  const targetMember = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    include: {
      user: { select: { fullName: true } },
      strengths: {
        where: { rank: { lte: 5 } },
        include: { theme: { include: { domain: true } } },
      },
    },
  });

  if (!targetMember) {
    return { error: "Member not found" };
  }

  const targetDomains = new Set(targetMember.strengths.map((s) => s.theme.domain.slug));
  const missingDomains = DOMAINS.filter((d) => !targetDomains.has(d.slug));

  const potentialPartners = await prisma.organizationMember.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      id: { not: memberId },
      strengths: {
        some: {
          theme: { domain: { slug: { in: missingDomains.map((d) => d.slug) } } },
          rank: { lte: 5 },
        },
      },
    },
    include: {
      user: { select: { fullName: true, jobTitle: true } },
      strengths: {
        where: { rank: { lte: 5 } },
        include: { theme: { include: { domain: true } } },
      },
    },
    take: limit * 2,
  });

  const scoredPartners = potentialPartners.map((partner) => {
    const partnerDomains = new Set(partner.strengths.map((s) => s.theme.domain.slug));
    const complementaryCount = missingDomains.filter((d) => partnerDomains.has(d.slug)).length;
    const diversityBonus = partnerDomains.size >= 3 ? 1 : 0;

    return {
      partner,
      score: complementaryCount + diversityBonus,
      complementaryDomains: missingDomains
        .filter((d) => partnerDomains.has(d.slug))
        .map((d) => d.name),
    };
  });

  const topPartners = scoredPartners.sort((a, b) => b.score - a.score).slice(0, limit);

  return {
    forMember: {
      name: targetMember.user.fullName,
      topStrengths: targetMember.strengths.map((s) => s.theme.name),
      dominantDomains: Array.from(targetDomains),
    },
    suggestions: topPartners.map((p) => ({
      id: p.partner.id,
      name: p.partner.user.fullName,
      jobTitle: p.partner.user.jobTitle,
      topStrengths: p.partner.strengths.map((s) => s.theme.name),
      complementaryDomains: p.complementaryDomains,
      reason: `Brings ${p.complementaryDomains.join(" and ")} strengths`,
    })),
  };
}

// Tool definitions for AI SDK
export const chatToolDefinitions = {
  searchMembers: {
    description: "Search for team members by their CliftonStrengths themes or domains",
    parameters: searchMembersSchema,
  },
  getTeamComposition: {
    description: "Get statistics about the team's strength composition",
    parameters: getTeamCompositionSchema,
  },
  explainStrength: {
    description: "Get detailed information about a CliftonStrengths theme",
    parameters: explainStrengthSchema,
  },
  suggestPartners: {
    description: "Suggest collaboration partners based on complementary strengths",
    parameters: suggestPartnersSchema,
  },
};
