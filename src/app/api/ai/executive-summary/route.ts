import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import {
  generate,
  checkAIReady,
} from "@/lib/ai";
import { buildTeamContext, formatTeamContextForPrompt } from "@/lib/ai/context/team-context";
import { prisma } from "@/lib/prisma";

const executiveSummarySchema = z.object({
  period: z.enum(["week", "month", "quarter"]).optional().default("month"),
  includeRecommendations: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;
    const role = session.user.role;

    if (!organizationId || !memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Only admins/owners can generate executive summaries
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    // Check if AI is configured
    const aiReady = checkAIReady();
    if (!aiReady.ready) {
      return apiError(ApiErrorCode.INTERNAL_ERROR, aiReady.reason || "AI service unavailable");
    }

    const body = await request.json();
    const validation = executiveSummarySchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { period, includeRecommendations } = validation.data;

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "quarter":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Build team context
    const teamContext = await buildTeamContext(organizationId);

    if (!teamContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Organization not found");
    }

    // Get activity metrics for the period
    const [
      shoutoutCount,
      skillRequestCount,
      completedChallenges,
      newBadges,
      topRecognizers,
      topRecognized,
      topPointEarners,
    ] = await Promise.all([
      prisma.shoutout.count({
        where: { organizationId, createdAt: { gte: startDate } },
      }),
      prisma.skillRequest.count({
        where: { organizationId, createdAt: { gte: startDate } },
      }),
      prisma.challengeParticipant.count({
        where: {
          challenge: { organizationId },
          completedAt: { gte: startDate },
        },
      }),
      prisma.badgeEarned.count({
        where: {
          member: { organizationId },
          earnedAt: { gte: startDate },
        },
      }),
      prisma.shoutout.groupBy({
        by: ["giverId"],
        where: { organizationId, createdAt: { gte: startDate } },
        _count: true,
        orderBy: { _count: { giverId: "desc" } },
        take: 5,
      }),
      prisma.shoutout.groupBy({
        by: ["receiverId"],
        where: { organizationId, createdAt: { gte: startDate } },
        _count: true,
        orderBy: { _count: { receiverId: "desc" } },
        take: 5,
      }),
      prisma.organizationMember.findMany({
        where: { organizationId, status: "ACTIVE" },
        orderBy: { points: "desc" },
        take: 5,
        include: {
          user: { select: { fullName: true } },
        },
      }),
    ]);

    // Get member names for top lists
    const recognizerIds = topRecognizers.map((r) => r.giverId);
    const recognizedIds = topRecognized.map((r) => r.receiverId);
    const allIds = [...new Set([...recognizerIds, ...recognizedIds])];

    const memberNames = await prisma.organizationMember.findMany({
      where: { id: { in: allIds } },
      select: { id: true, user: { select: { fullName: true } } },
    });

    const nameMap = new Map(memberNames.map((m) => [m.id, m.user.fullName]));

    // Format context for prompt
    const contextString = formatTeamContextForPrompt(teamContext);

    // Build activity data for prompt
    const activityData = {
      period,
      shoutouts: shoutoutCount,
      skillRequests: skillRequestCount,
      challengesCompleted: completedChallenges,
      badgesEarned: newBadges,
      topRecognizers: topRecognizers.slice(0, 3).map((r) => ({
        name: nameMap.get(r.giverId) || "Unknown",
        count: r._count,
      })),
      topRecognized: topRecognized.slice(0, 3).map((r) => ({
        name: nameMap.get(r.receiverId) || "Unknown",
        count: r._count,
      })),
      topPointEarners: topPointEarners.slice(0, 3).map((m) => ({
        name: m.user.fullName,
        points: m.points,
      })),
    };

    // Build system prompt
    const systemPrompt = `You are a team analytics expert generating executive summaries for leadership.

Your role is to:
1. Summarize key metrics and trends in a clear, executive-friendly format
2. Highlight wins and areas for celebration
3. Identify potential concerns or opportunities
4. ${includeRecommendations ? "Provide strategic recommendations" : "Focus on data and insights without recommendations"}

Write in a professional, concise style suitable for leadership review.

Return your response as a JSON object with this structure:
{
  "headline": "One impactful sentence summarizing the period",
  "highlights": ["3-5 key achievements or positive trends"],
  "concerns": ["1-3 areas needing attention, if any"],
  "engagement": {
    "score": "high|medium|low based on activity levels",
    "trend": "improving|stable|declining",
    "insight": "Brief explanation"
  },
  "teamHealth": {
    "strengthsUtilization": "Assessment of how well team leverages strengths",
    "recognition": "Assessment of recognition culture",
    "collaboration": "Assessment of team collaboration"
  }${includeRecommendations ? `,
  "recommendations": [
    {
      "priority": 1-3,
      "action": "Specific recommended action",
      "rationale": "Why this matters"
    }
  ]` : ""}
}`;

    // Build user prompt
    const userPrompt = `Generate an executive summary for the ${period === "week" ? "past week" : period === "month" ? "past month" : "past quarter"}.

**Team Profile:**
${contextString}

**Activity Metrics (${period}):**
- Recognition shoutouts given: ${activityData.shoutouts}
- Skill requests posted: ${activityData.skillRequests}
- Challenges completed: ${activityData.challengesCompleted}
- Badges earned: ${activityData.badgesEarned}

**Top Recognizers:**
${activityData.topRecognizers.map((r, i) => `${i + 1}. ${r.name}: ${r.count} shoutouts`).join("\n")}

**Most Recognized:**
${activityData.topRecognized.map((r, i) => `${i + 1}. ${r.name}: ${r.count} shoutouts received`).join("\n")}

**Top Point Earners:**
${activityData.topPointEarners.map((m, i) => `${i + 1}. ${m.name}: ${m.points} points`).join("\n")}

Generate an executive summary. Return only valid JSON.`;

    // Generate summary
    const result = await generate({
      memberId,
      organizationId,
      feature: "executive-summary",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Executive Summary] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to generate summary"
      );
    }

    // Parse the JSON response
    let summary;
    try {
      let cleanedResponse = (result.data || "").trim();
      if (cleanedResponse.startsWith("```json")) {
        cleanedResponse = cleanedResponse.slice(7);
      } else if (cleanedResponse.startsWith("```")) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith("```")) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      cleanedResponse = cleanedResponse.trim();

      summary = JSON.parse(cleanedResponse);
    } catch {
      console.warn("[AI Executive Summary] Failed to parse JSON, returning raw text");
      summary = {
        headline: "Executive summary generated",
        highlights: [result.data],
        concerns: [],
        engagement: {
          score: "medium",
          trend: "stable",
          insight: "See detailed analysis",
        },
        teamHealth: {
          strengthsUtilization: "Analysis complete",
          recognition: "See highlights",
          collaboration: "See metrics",
        },
      };
    }

    console.log(`[AI Executive Summary] Generated ${period} summary for org ${organizationId}`);

    return apiSuccess({
      ...summary,
      period,
      dateRange: {
        start: startDate.toISOString(),
        end: now.toISOString(),
      },
      metrics: activityData,
      teamStats: {
        memberCount: teamContext.memberCount,
        membersWithStrengths: teamContext.membersWithStrengths,
        topDomains: teamContext.domainDistribution
          .sort((a, b) => b.percentage - a.percentage)
          .slice(0, 2)
          .map((d) => d.name),
      },
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Executive Summary Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate executive summary");
  }
}
