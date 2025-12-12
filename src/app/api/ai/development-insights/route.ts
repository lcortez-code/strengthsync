import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import {
  generate,
  checkAIReady,
  getMinimalUserContext,
} from "@/lib/ai";
import { prisma } from "@/lib/prisma";

const developmentInsightsSchema = z.object({
  targetMemberId: z.string().optional(), // If not provided, uses current user
  focusTheme: z.string().optional(), // Focus on a specific strength
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

    // Check if AI is configured
    const aiReady = checkAIReady();
    if (!aiReady.ready) {
      return apiError(ApiErrorCode.INTERNAL_ERROR, aiReady.reason || "AI service unavailable");
    }

    const body = await request.json();
    const validation = developmentInsightsSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { targetMemberId, focusTheme } = validation.data;
    const targetId = targetMemberId || memberId;

    // Get member context
    const userContext = await getMinimalUserContext(targetId);

    if (!userContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Member not found");
    }

    if (userContext.topStrengths.length === 0) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "Member needs a strength profile to generate development insights"
      );
    }

    // Get additional context for richer insights
    const memberDetails = await prisma.organizationMember.findFirst({
      where: { id: targetId },
      include: {
        user: {
          select: { fullName: true, jobTitle: true },
        },
        strengths: {
          where: { rank: { lte: 10 } },
          include: {
            theme: {
              include: {
                domain: { select: { name: true, slug: true } },
              },
            },
          },
          orderBy: { rank: "asc" },
        },
        shoutoutsReceived: {
          take: 5,
          orderBy: { createdAt: "desc" },
          include: {
            theme: { select: { name: true } },
          },
        },
      },
    });

    if (!memberDetails) {
      return apiError(ApiErrorCode.NOT_FOUND, "Member details not found");
    }

    // Build strength profile for prompt
    const strengthProfile = memberDetails.strengths.map((s) => ({
      rank: s.rank,
      name: s.theme.name,
      domain: s.theme.domain.name,
    }));

    // Get recent recognition themes
    const recognizedStrengths = memberDetails.shoutoutsReceived
      .filter((s) => s.theme)
      .map((s) => s.theme!.name);

    // Build system prompt
    const systemPrompt = `You are a CliftonStrengths development coach helping individuals leverage their unique talents.

Your role is to provide personalized development insights that:
1. Help people understand the power of their top strengths
2. Identify potential blind spots and areas of overuse
3. Suggest specific ways to develop and apply each strength
4. Connect strengths to practical workplace scenarios

Important CliftonStrengths principles:
- Focus on developing strengths, not fixing weaknesses
- Each strength has a "balcony" (positive application) and a "basement" (potential overuse)
- Strengths work best in combination, not isolation
- Development happens through intentional practice

Return your response as a JSON object with this structure:
{
  "overview": "2-3 sentence personalized summary of this person's strength profile",
  "insights": [
    {
      "strength": "Strength name",
      "domain": "Domain name",
      "powerStatement": "What this strength enables them to do uniquely well",
      "developmentTips": ["Specific tip 1", "Specific tip 2"],
      "watchOut": "Potential blind spot or overuse pattern",
      "partnership": "Types of strengths that complement this one well"
    }
  ],
  "actionPlan": {
    "thisWeek": "One specific action to take this week",
    "thisMonth": "A development goal for this month",
    "partnerships": ["Names of complementary strengths to seek in collaboration"]
  }
}`;

    // Build user prompt
    let userPrompt = `Generate development insights for ${memberDetails.user.fullName}${memberDetails.user.jobTitle ? ` (${memberDetails.user.jobTitle})` : ""}.

**Strength Profile (Top ${strengthProfile.length}):**
${strengthProfile.map((s) => `${s.rank}. ${s.name} (${s.domain})`).join("\n")}

**Domain Distribution:**
${Object.entries(
  strengthProfile.reduce((acc, s) => {
    acc[s.domain] = (acc[s.domain] || 0) + 1;
    return acc;
  }, {} as Record<string, number>)
).map(([domain, count]) => `- ${domain}: ${count} strengths`).join("\n")}`;

    if (recognizedStrengths.length > 0) {
      userPrompt += `

**Strengths Recently Recognized by Team:**
${[...new Set(recognizedStrengths)].join(", ")}`;
    }

    if (focusTheme) {
      userPrompt += `

**Requested Focus:** Please provide deeper insights specifically for the "${focusTheme}" strength.`;
    } else {
      userPrompt += `

Provide insights for their top 3-5 strengths. Return only valid JSON.`;
    }

    // Generate insights
    const result = await generate({
      memberId,
      organizationId,
      feature: "development-insights",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Development Insights] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to generate insights"
      );
    }

    // Parse the JSON response
    let insights;
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

      insights = JSON.parse(cleanedResponse);
    } catch {
      console.warn("[AI Development Insights] Failed to parse JSON, returning raw text");
      insights = {
        overview: "Development insights generated",
        insights: [{
          strength: strengthProfile[0]?.name || "Top Strength",
          domain: strengthProfile[0]?.domain || "Unknown",
          powerStatement: result.data,
          developmentTips: [],
          watchOut: "",
          partnership: "",
        }],
        actionPlan: {
          thisWeek: "",
          thisMonth: "",
          partnerships: [],
        },
      };
    }

    console.log(`[AI Development Insights] Generated for member ${targetId}`);

    return apiSuccess({
      ...insights,
      member: {
        id: targetId,
        name: memberDetails.user.fullName,
        jobTitle: memberDetails.user.jobTitle,
        strengthCount: strengthProfile.length,
        topDomain: Object.entries(
          strengthProfile.reduce((acc, s) => {
            acc[s.domain] = (acc[s.domain] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        ).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      },
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Development Insights Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate development insights");
  }
}
