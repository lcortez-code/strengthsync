import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

// Complementary and friction patterns between themes
const THEME_INTERACTIONS: Record<string, { complementary: string[]; friction: string[] }> = {
  achiever: {
    complementary: ["strategic", "focus", "discipline"],
    friction: ["adaptability", "positivity"],
  },
  activator: {
    complementary: ["ideation", "strategic", "futuristic"],
    friction: ["deliberative", "analytical"],
  },
  adaptability: {
    complementary: ["positivity", "empathy", "includer"],
    friction: ["discipline", "focus", "deliberative"],
  },
  analytical: {
    complementary: ["strategic", "deliberative", "input"],
    friction: ["activator", "positivity", "woo"],
  },
  arranger: {
    complementary: ["achiever", "strategic", "adaptability"],
    friction: ["consistency", "discipline"],
  },
  belief: {
    complementary: ["responsibility", "relator", "consistency"],
    friction: ["adaptability", "strategic"],
  },
  command: {
    complementary: ["activator", "self-assurance", "competition"],
    friction: ["harmony", "empathy", "includer"],
  },
  communication: {
    complementary: ["woo", "positivity", "ideation"],
    friction: ["deliberative", "analytical"],
  },
  competition: {
    complementary: ["achiever", "significance", "focus"],
    friction: ["harmony", "includer", "adaptability"],
  },
  connectedness: {
    complementary: ["empathy", "relator", "includer"],
    friction: ["competition", "command"],
  },
  consistency: {
    complementary: ["discipline", "responsibility", "deliberative"],
    friction: ["adaptability", "arranger", "individualization"],
  },
  context: {
    complementary: ["analytical", "deliberative", "learner"],
    friction: ["futuristic", "activator"],
  },
  deliberative: {
    complementary: ["analytical", "responsibility", "consistency"],
    friction: ["activator", "woo", "positivity"],
  },
  developer: {
    complementary: ["individualization", "empathy", "positivity"],
    friction: ["command", "competition"],
  },
  discipline: {
    complementary: ["focus", "responsibility", "consistency"],
    friction: ["adaptability", "ideation"],
  },
  empathy: {
    complementary: ["relator", "developer", "harmony"],
    friction: ["command", "competition"],
  },
  focus: {
    complementary: ["achiever", "discipline", "strategic"],
    friction: ["adaptability", "ideation", "input"],
  },
  futuristic: {
    complementary: ["ideation", "strategic", "activator"],
    friction: ["context", "deliberative"],
  },
  harmony: {
    complementary: ["empathy", "relator", "includer"],
    friction: ["command", "competition", "activator"],
  },
  ideation: {
    complementary: ["futuristic", "strategic", "input"],
    friction: ["focus", "discipline", "consistency"],
  },
  includer: {
    complementary: ["empathy", "harmony", "relator"],
    friction: ["competition", "command"],
  },
  individualization: {
    complementary: ["developer", "relator", "empathy"],
    friction: ["consistency"],
  },
  input: {
    complementary: ["learner", "analytical", "context"],
    friction: ["focus", "discipline"],
  },
  intellection: {
    complementary: ["learner", "input", "analytical"],
    friction: ["activator", "woo"],
  },
  learner: {
    complementary: ["input", "intellection", "context"],
    friction: ["activator"],
  },
  maximizer: {
    complementary: ["achiever", "significance", "focus"],
    friction: ["restorative", "includer"],
  },
  positivity: {
    complementary: ["woo", "communication", "developer"],
    friction: ["deliberative", "analytical"],
  },
  relator: {
    complementary: ["empathy", "individualization", "developer"],
    friction: ["woo", "competition"],
  },
  responsibility: {
    complementary: ["achiever", "belief", "consistency"],
    friction: ["adaptability"],
  },
  restorative: {
    complementary: ["analytical", "deliberative", "input"],
    friction: ["maximizer", "positivity"],
  },
  "self-assurance": {
    complementary: ["command", "activator", "significance"],
    friction: ["empathy", "harmony"],
  },
  significance: {
    complementary: ["achiever", "competition", "self-assurance"],
    friction: ["includer", "harmony"],
  },
  strategic: {
    complementary: ["ideation", "analytical", "futuristic"],
    friction: ["consistency", "discipline"],
  },
  woo: {
    complementary: ["communication", "positivity", "includer"],
    friction: ["relator", "deliberative", "analytical"],
  },
};

// Collaboration tips based on domain combinations
const DOMAIN_TIPS: Record<string, Record<string, string[]>> = {
  executing: {
    executing: [
      "Divide tasks based on individual strengths",
      "Set clear milestones and accountability checkpoints",
      "Celebrate completed work together",
    ],
    influencing: [
      "Let the Influencer handle stakeholder communication",
      "Executor focuses on delivery while Influencer manages expectations",
      "Balance doing with communicating progress",
    ],
    relationship: [
      "Relationship Builder can help manage team dynamics",
      "Executor provides structure, Relationship Builder provides support",
      "Schedule regular check-ins to maintain connection",
    ],
    strategic: [
      "Strategic Thinker plans, Executor implements",
      "Request analysis before major decisions",
      "Use data-driven approaches together",
    ],
  },
  influencing: {
    influencing: [
      "Clarify who leads which conversations",
      "Support each other's ideas publicly",
      "Take turns in the spotlight",
    ],
    relationship: [
      "Influencer can advocate while Relationship Builder deepens connections",
      "Balance outreach with relationship maintenance",
      "Share network insights",
    ],
    strategic: [
      "Strategic input strengthens Influencer's message",
      "Collaborate on presentations and proposals",
      "Use analysis to support persuasion",
    ],
  },
  relationship: {
    relationship: [
      "Leverage your combined network",
      "Support each other emotionally during challenges",
      "Create team-building opportunities together",
    ],
    strategic: [
      "Strategic Thinker can help with difficult decisions",
      "Relationship Builder ensures people feel heard",
      "Balance logic with emotional intelligence",
    ],
  },
  strategic: {
    strategic: [
      "Debate ideas constructively",
      "Document your strategic discussions",
      "Take turns playing devil's advocate",
    ],
  },
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const { searchParams } = new URL(request.url);
    const member1Id = searchParams.get("member1");
    const member2Id = searchParams.get("member2");

    if (!member1Id || !member2Id) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Both member1 and member2 IDs are required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Fetch both members with their strengths
    const [member1, member2] = await Promise.all([
      prisma.organizationMember.findFirst({
        where: { id: member1Id, organizationId, status: "ACTIVE" },
        include: {
          user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
          strengths: {
            where: { rank: { lte: 10 } },
            include: { theme: { include: { domain: true } } },
            orderBy: { rank: "asc" },
          },
        },
      }),
      prisma.organizationMember.findFirst({
        where: { id: member2Id, organizationId, status: "ACTIVE" },
        include: {
          user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
          strengths: {
            where: { rank: { lte: 10 } },
            include: { theme: { include: { domain: true } } },
            orderBy: { rank: "asc" },
          },
        },
      }),
    ]);

    if (!member1 || !member2) {
      return apiError(ApiErrorCode.NOT_FOUND, "One or both members not found");
    }

    // Analyze complementary strengths
    const complementaryStrengths: { theme1: string; theme2: string; reason: string }[] = [];
    const potentialFriction: { theme1: string; theme2: string; tip: string }[] = [];

    member1.strengths.slice(0, 5).forEach((s1) => {
      const interactions = THEME_INTERACTIONS[s1.theme.slug];
      if (!interactions) return;

      member2.strengths.slice(0, 5).forEach((s2) => {
        if (interactions.complementary.includes(s2.theme.slug)) {
          complementaryStrengths.push({
            theme1: s1.theme.name,
            theme2: s2.theme.name,
            reason: `${s1.theme.name} and ${s2.theme.name} naturally enhance each other`,
          });
        }
        if (interactions.friction.includes(s2.theme.slug)) {
          potentialFriction.push({
            theme1: s1.theme.name,
            theme2: s2.theme.name,
            tip: `Be aware that ${s1.theme.name} and ${s2.theme.name} may approach things differently - communicate expectations clearly`,
          });
        }
      });
    });

    // Get domain distribution for each member
    const getDomainDist = (strengths: typeof member1.strengths) => {
      const dist: Record<string, number> = {};
      strengths.slice(0, 5).forEach((s) => {
        const d = s.theme.domain.slug;
        dist[d] = (dist[d] || 0) + 1;
      });
      return dist;
    };

    const member1Domains = getDomainDist(member1.strengths);
    const member2Domains = getDomainDist(member2.strengths);

    // Get dominant domains
    const getDominant = (dist: Record<string, number>): string => {
      return Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0] || "executing";
    };

    const domain1 = getDominant(member1Domains);
    const domain2 = getDominant(member2Domains);

    // Get collaboration tips
    const domainKey1 = domain1 < domain2 ? domain1 : domain2;
    const domainKey2 = domain1 < domain2 ? domain2 : domain1;
    const tips = DOMAIN_TIPS[domainKey1]?.[domainKey2] || [
      "Schedule regular sync meetings",
      "Share your working styles and preferences",
      "Celebrate wins together",
    ];

    // Build the guide
    const guide = {
      member1: {
        id: member1.id,
        name: member1.user.fullName || "Unknown",
        avatarUrl: member1.user.avatarUrl,
        jobTitle: member1.user.jobTitle,
        topStrengths: member1.strengths.slice(0, 5).map((s) => ({
          name: s.theme.name,
          domain: s.theme.domain.slug,
        })),
        dominantDomain: domain1,
      },
      member2: {
        id: member2.id,
        name: member2.user.fullName || "Unknown",
        avatarUrl: member2.user.avatarUrl,
        jobTitle: member2.user.jobTitle,
        topStrengths: member2.strengths.slice(0, 5).map((s) => ({
          name: s.theme.name,
          domain: s.theme.domain.slug,
        })),
        dominantDomain: domain2,
      },
      complementaryStrengths: complementaryStrengths.slice(0, 5),
      potentialFriction: potentialFriction.slice(0, 3),
      collaborationTips: tips,
      sharedStrengths: member1.strengths
        .filter((s1) => member2.strengths.some((s2) => s2.theme.slug === s1.theme.slug))
        .map((s) => s.theme.name),
    };

    return apiSuccess(guide);
  } catch (error) {
    console.error("[Partnership Guide Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate partnership guide");
  }
}
