import { prisma } from "@/lib/prisma";

export interface UserStrengthContext {
  name: string;
  rank: number;
  domain: string;
  domainSlug: string;
  personalizedDescription?: string;
}

export interface MentorshipInfo {
  partnerName: string;
  partnerStrengths: string[];
  role: "mentor" | "mentee";
  status: string;
  focusAreas?: string[];
}

export interface ShoutoutInfo {
  type: "given" | "received";
  otherPerson: string;
  message: string;
  themes: string[];
  date: string;
}

export interface SkillRequestInfo {
  title: string;
  status: string;
  type: "created" | "responded";
  skills: string[];
}

export interface ChallengeInfo {
  name: string;
  status: string;
  type: string;
  progress?: number;
  completedAt?: string;
}

export interface ReviewInfo {
  cycleName: string;
  status: string;
  overallRating?: string;
  goalCount: number;
}

export interface UserContext {
  memberId: string;
  userId: string;
  fullName: string;
  email: string;
  jobTitle?: string;
  department?: string;
  bio?: string;
  role: string;
  joinedAt: string;
  topStrengths: UserStrengthContext[];
  allStrengths: UserStrengthContext[];
  dominantDomain: string | null;
  badges: string[];
  points: number;
  leaderboardRank?: number;
  mentorships: MentorshipInfo[];
  recentShoutouts: ShoutoutInfo[];
  skillRequests: SkillRequestInfo[];
  challenges: ChallengeInfo[];
  reviews: ReviewInfo[];
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
          email: true,
          jobTitle: true,
          department: true,
          bio: true,
        },
      },
      organization: {
        select: { id: true },
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
      // Mentorships where user is mentor
      mentorshipsAsMentor: {
        include: {
          mentee: {
            include: {
              user: { select: { fullName: true } },
              strengths: {
                where: { rank: { lte: 5 } },
                include: { theme: { select: { name: true } } },
              },
            },
          },
        },
      },
      // Mentorships where user is mentee
      mentorshipsAsMentee: {
        include: {
          mentor: {
            include: {
              user: { select: { fullName: true } },
              strengths: {
                where: { rank: { lte: 5 } },
                include: { theme: { select: { name: true } } },
              },
            },
          },
        },
      },
      // Shoutouts given
      shoutoutsGiven: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          receiver: {
            include: { user: { select: { fullName: true } } },
          },
          theme: { select: { name: true } },
        },
      },
      // Shoutouts received
      shoutoutsReceived: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          giver: {
            include: { user: { select: { fullName: true } } },
          },
          theme: { select: { name: true } },
        },
      },
      // Skill requests created
      skillRequestsCreated: {
        take: 10,
        orderBy: { createdAt: "desc" },
      },
      // Skill request responses
      skillRequestResponses: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          request: {
            select: { title: true },
          },
        },
      },
      // Challenge participations
      challengeParticipations: {
        include: {
          challenge: {
            select: { name: true, challengeType: true, status: true },
          },
        },
      },
      // Reviews
      reviewsAsSubject: {
        include: {
          cycle: { select: { name: true } },
          _count: { select: { goals: true } },
        },
      },
    },
  });

  if (!member) {
    return null;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get leaderboard rank
  const membersAbove = await prisma.organizationMember.count({
    where: {
      organizationId: member.organization.id,
      status: "ACTIVE",
      points: { gt: member.points },
    },
  });
  const leaderboardRank = membersAbove + 1;

  // Count recent activity
  const shoutoutsGivenCount = member.shoutoutsGiven.filter(
    (s) => new Date(s.createdAt) >= thirtyDaysAgo
  ).length;
  const shoutoutsReceivedCount = member.shoutoutsReceived.filter(
    (s) => new Date(s.createdAt) >= thirtyDaysAgo
  ).length;
  const responsesAccepted = member.skillRequestResponses.filter(
    (r) => r.status === "COMPLETED" && new Date(r.createdAt) >= thirtyDaysAgo
  ).length;
  const challengesCompletedCount = member.challengeParticipations.filter(
    (c) => c.completedAt && new Date(c.completedAt) >= thirtyDaysAgo
  ).length;

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

  // Transform mentorships
  const mentorships: MentorshipInfo[] = [
    ...member.mentorshipsAsMentor.map((m) => ({
      partnerName: m.mentee.user.fullName,
      partnerStrengths: m.mentee.strengths.map((s) => s.theme.name),
      role: "mentor" as const,
      status: m.status,
      focusAreas: m.focusAreas as string[] | undefined,
    })),
    ...member.mentorshipsAsMentee.map((m) => ({
      partnerName: m.mentor.user.fullName,
      partnerStrengths: m.mentor.strengths.map((s) => s.theme.name),
      role: "mentee" as const,
      status: m.status,
      focusAreas: m.focusAreas as string[] | undefined,
    })),
  ];

  // Transform shoutouts
  const recentShoutouts: ShoutoutInfo[] = [
    ...member.shoutoutsGiven.map((s) => ({
      type: "given" as const,
      otherPerson: s.receiver.user.fullName,
      message: s.message,
      themes: s.theme ? [s.theme.name] : [],
      date: s.createdAt.toISOString().split("T")[0],
    })),
    ...member.shoutoutsReceived.map((s) => ({
      type: "received" as const,
      otherPerson: s.giver.user.fullName,
      message: s.message,
      themes: s.theme ? [s.theme.name] : [],
      date: s.createdAt.toISOString().split("T")[0],
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  // Transform skill requests
  const skillRequests: SkillRequestInfo[] = [
    ...member.skillRequestsCreated.map((r) => ({
      title: r.title,
      status: r.status,
      type: "created" as const,
      skills: [],
    })),
    ...member.skillRequestResponses.map((r) => ({
      title: r.request.title,
      status: r.status,
      type: "responded" as const,
      skills: [],
    })),
  ];

  // Transform challenges
  const challenges: ChallengeInfo[] = member.challengeParticipations.map((c) => ({
    name: c.challenge.name,
    status: c.completedAt ? "COMPLETED" : "IN_PROGRESS",
    type: c.challenge.challengeType,
    completedAt: c.completedAt?.toISOString().split("T")[0],
  }));

  // Transform reviews
  const reviews: ReviewInfo[] = member.reviewsAsSubject.map((r) => ({
    cycleName: r.cycle.name,
    status: r.status,
    overallRating: r.overallRating || undefined,
    goalCount: r._count.goals,
  }));

  return {
    memberId,
    userId: member.user.id,
    fullName: member.user.fullName,
    email: member.user.email,
    jobTitle: member.user.jobTitle || undefined,
    department: member.user.department || undefined,
    bio: member.user.bio || undefined,
    role: member.role,
    joinedAt: member.joinedAt.toISOString().split("T")[0],
    topStrengths,
    allStrengths,
    dominantDomain,
    badges: member.badgesEarned.map((b) => b.badge.name),
    points: member.points,
    leaderboardRank,
    mentorships,
    recentShoutouts,
    skillRequests,
    challenges,
    reviews,
    recentActivity: {
      shoutoutsGiven: shoutoutsGivenCount,
      shoutoutsReceived: shoutoutsReceivedCount,
      skillRequestsHelped: responsesAccepted,
      challengesCompleted: challengesCompletedCount,
    },
  };
}

// Format user context as a string for AI prompts
export function formatUserContextForPrompt(context: UserContext): string {
  const lines: string[] = [];

  lines.push(`**${context.fullName}** (${context.email})`);
  lines.push(`Role: ${context.role} | Joined: ${context.joinedAt}`);
  if (context.jobTitle) {
    lines.push(`Job Title: ${context.jobTitle}`);
  }
  if (context.department) {
    lines.push(`Department: ${context.department}`);
  }
  if (context.bio) {
    lines.push(`Bio: ${context.bio}`);
  }

  // Strengths
  if (context.allStrengths.length > 0) {
    lines.push("\n**Complete CliftonStrengths Profile:**");
    const top5 = context.allStrengths.filter(s => s.rank <= 5);
    const ranks6to10 = context.allStrengths.filter(s => s.rank > 5 && s.rank <= 10);
    const ranks11to20 = context.allStrengths.filter(s => s.rank > 10 && s.rank <= 20);
    const bottom14 = context.allStrengths.filter(s => s.rank > 20);

    if (top5.length > 0) {
      lines.push(`Top 5 (Signature): ${top5.map(s => `${s.rank}. ${s.name} [${s.domain}]`).join(", ")}`);
    }
    if (ranks6to10.length > 0) {
      lines.push(`Ranks 6-10: ${ranks6to10.map(s => `${s.rank}. ${s.name}`).join(", ")}`);
    }
    if (ranks11to20.length > 0) {
      lines.push(`Ranks 11-20: ${ranks11to20.map(s => `${s.rank}. ${s.name}`).join(", ")}`);
    }
    if (bottom14.length > 0) {
      lines.push(`Ranks 21-34 (Lesser): ${bottom14.map(s => `${s.rank}. ${s.name}`).join(", ")}`);
    }
  }

  if (context.dominantDomain) {
    lines.push(`Dominant Domain: ${context.dominantDomain}`);
  }

  // Gamification
  lines.push(`\n**Gamification:**`);
  lines.push(`Points: ${context.points} | Leaderboard Rank: #${context.leaderboardRank}`);
  if (context.badges.length > 0) {
    lines.push(`Badges: ${context.badges.join(", ")}`);
  }

  // Mentorships
  if (context.mentorships.length > 0) {
    lines.push(`\n**Mentorships:**`);
    for (const m of context.mentorships) {
      lines.push(`- ${m.role === "mentor" ? "Mentoring" : "Mentee of"} ${m.partnerName} (${m.status}) - Their strengths: ${m.partnerStrengths.join(", ")}`);
    }
  }

  // Recent shoutouts
  if (context.recentShoutouts.length > 0) {
    lines.push(`\n**Recent Shoutouts:**`);
    for (const s of context.recentShoutouts.slice(0, 5)) {
      const direction = s.type === "given" ? `→ ${s.otherPerson}` : `← from ${s.otherPerson}`;
      lines.push(`- ${s.date} ${direction}: "${s.message.substring(0, 80)}${s.message.length > 80 ? "..." : ""}"`);
    }
  }

  // Skill requests
  if (context.skillRequests.length > 0) {
    lines.push(`\n**Skill Marketplace Activity:**`);
    for (const r of context.skillRequests.slice(0, 5)) {
      lines.push(`- ${r.type === "created" ? "Requested" : "Responded to"}: "${r.title}" (${r.status})`);
    }
  }

  // Challenges
  if (context.challenges.length > 0) {
    lines.push(`\n**Challenge Participation:**`);
    for (const c of context.challenges) {
      lines.push(`- ${c.name} (${c.type}): ${c.status}${c.completedAt ? ` - Completed ${c.completedAt}` : ""}`);
    }
  }

  // Reviews
  if (context.reviews.length > 0) {
    lines.push(`\n**Performance Reviews:**`);
    for (const r of context.reviews) {
      lines.push(`- ${r.cycleName}: ${r.status}${r.overallRating ? ` - Rating: ${r.overallRating}` : ""} (${r.goalCount} goals)`);
    }
  }

  // Recent activity summary
  const activity = context.recentActivity;
  lines.push("\n**Recent Activity (30 days):**");
  lines.push(`Shoutouts: ${activity.shoutoutsGiven} given, ${activity.shoutoutsReceived} received`);
  lines.push(`Skill requests helped: ${activity.skillRequestsHelped}`);
  lines.push(`Challenges completed: ${activity.challengesCompleted}`);

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
