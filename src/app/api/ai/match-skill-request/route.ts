import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { generateStructured, checkAIReady } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { THEMES, DOMAINS } from "@/constants/strengths-data";

const matchSkillRequestSchema = z.object({
  requestId: z.string().min(1, "Skill request ID is required"),
  limit: z.number().min(1).max(10).optional().default(5),
});

// Structured output for match analysis
const matchResultSchema = z.object({
  matches: z.array(
    z.object({
      memberId: z.string(),
      score: z.number().min(0).max(100).describe("Match score 0-100"),
      reasoning: z.string().describe("Why this person is a good match (1-2 sentences)"),
      relevantStrengths: z.array(z.string()).describe("Which of their strengths apply"),
      recommendedApproach: z.string().describe("How they might approach helping"),
    })
  ),
  noMatchReason: z.string().optional().describe("If no good matches, explain why"),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;

    if (!organizationId || !memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const aiReady = checkAIReady();
    if (!aiReady.ready) {
      return apiError(ApiErrorCode.INTERNAL_ERROR, aiReady.reason || "AI service unavailable");
    }

    const body = await request.json();
    const validation = matchSkillRequestSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { requestId, limit } = validation.data;

    // Fetch the skill request with theme info
    const skillRequest = await prisma.skillRequest.findUnique({
      where: { id: requestId },
      include: {
        theme: {
          include: {
            domain: { select: { name: true, slug: true } },
          },
        },
        creator: {
          include: {
            user: { select: { fullName: true } },
          },
        },
      },
    });

    if (!skillRequest) {
      return apiError(ApiErrorCode.NOT_FOUND, "Skill request not found");
    }

    if (skillRequest.organizationId !== organizationId) {
      return apiError(ApiErrorCode.FORBIDDEN, "Access denied to this skill request");
    }

    // Fetch potential responders (org members with strengths, excluding creator)
    const potentialResponders = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        id: { not: skillRequest.creatorId },
        status: "ACTIVE",
        strengths: { some: {} }, // Has at least one strength
      },
      include: {
        user: {
          select: { fullName: true, jobTitle: true },
        },
        strengths: {
          where: { rank: { lte: 10 } }, // Top 10 strengths
          include: {
            theme: {
              include: {
                domain: { select: { name: true, slug: true } },
              },
            },
          },
          orderBy: { rank: "asc" },
        },
        // Get recent helpful activity
        skillRequestResponses: {
          where: { status: "COMPLETED" },
          take: 5,
        },
      },
      take: 20, // Limit to 20 candidates for analysis
    });

    if (potentialResponders.length === 0) {
      return apiSuccess({
        matches: [],
        request: {
          id: requestId,
          title: skillRequest.title,
          description: skillRequest.description,
        },
        noMatchReason: "No team members with strength profiles available to help",
      });
    }

    // Get theme details for the requested skill
    const requestedTheme = skillRequest.theme;
    const requestedDomain = skillRequest.domainNeeded;

    // Format candidates for AI analysis
    const candidatesSummary = potentialResponders.map((member) => {
      const topStrengths = member.strengths.slice(0, 5);
      const domainCounts: Record<string, number> = {};
      for (const s of topStrengths) {
        domainCounts[s.theme.domain.name] = (domainCounts[s.theme.domain.name] || 0) + 1;
      }
      const dominantDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Balanced";

      return {
        id: member.id,
        name: member.user.fullName,
        title: member.user.jobTitle,
        topStrengths: topStrengths.map((s) => ({
          name: s.theme.name,
          domain: s.theme.domain.name,
        })),
        dominantDomain,
        helpfulResponses: member.skillRequestResponses.length,
      };
    });

    const systemPrompt = `You are a CliftonStrengths-based team matching expert for StrengthSync.

Your role is to analyze skill requests and identify the best team members to help based on their strengths profiles.

The four CliftonStrengths domains are:
- **Executing**: Make things happen - good for implementation, follow-through, getting things done
- **Influencing**: Persuade and lead - good for communication, selling ideas, motivating
- **Relationship Building**: Connect people - good for collaboration, empathy, team harmony
- **Strategic Thinking**: Analyze and plan - good for problem-solving, research, strategy

When matching:
1. Look for direct strength matches (e.g., Analytical for data analysis requests)
2. Consider domain alignment (e.g., Strategic Thinking domain for planning tasks)
3. Value complementary strengths that could add unexpected value
4. Consider past helpful behavior as a positive indicator
5. Provide specific reasoning tied to their actual strengths`;

    const userPrompt = `Analyze this skill request and rank the best people to help:

**SKILL REQUEST:**
Title: ${skillRequest.title}
Description: ${skillRequest.description}
${requestedTheme ? `Requested Theme: ${requestedTheme.name} (${requestedTheme.domain.name})` : ""}
${requestedDomain ? `Requested Domain: ${requestedDomain}` : ""}
Urgency: ${skillRequest.urgency}
Requester: ${skillRequest.creator.user.fullName}

**POTENTIAL HELPERS:**
${candidatesSummary.map((c, i) => `
${i + 1}. ${c.name} (ID: ${c.id})
   ${c.title ? `Role: ${c.title}` : ""}
   Top Strengths: ${c.topStrengths.map((s) => `${s.name} [${s.domain}]`).join(", ")}
   Dominant Domain: ${c.dominantDomain}
   Past helpful responses: ${c.helpfulResponses}
`).join("\n")}

Rank the top ${limit} best matches. For each match, explain specifically which of their strengths make them suited for this request and how they might approach helping.`;

    const result = await generateStructured({
      memberId,
      organizationId,
      feature: "match-skill-request",
      prompt: userPrompt,
      systemPrompt,
      schema: matchResultSchema,
      schemaName: "skill_request_matches",
    });

    if (!result.success) {
      console.error("[AI Skill Request Match] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to analyze skill request matches"
      );
    }

    // Enrich matches with full member data
    const enrichedMatches = result.data?.matches.map((match) => {
      const member = potentialResponders.find((m) => m.id === match.memberId);
      return {
        ...match,
        member: member
          ? {
              id: member.id,
              name: member.user.fullName,
              jobTitle: member.user.jobTitle,
              topStrengths: member.strengths.slice(0, 5).map((s) => ({
                name: s.theme.name,
                domain: s.theme.domain.name,
                rank: s.rank,
              })),
            }
          : null,
      };
    }).filter((m) => m.member !== null);

    console.log(`[AI Skill Request Match] Found ${enrichedMatches?.length || 0} matches for request ${requestId}`);

    return apiSuccess({
      matches: enrichedMatches || [],
      request: {
        id: requestId,
        title: skillRequest.title,
        description: skillRequest.description,
        theme: requestedTheme?.name,
        domain: requestedDomain || requestedTheme?.domain.name,
      },
      noMatchReason: result.data?.noMatchReason,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Skill Request Match Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to match skill request");
  }
}
