import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import {
  generate,
  checkAIReady,
} from "@/lib/ai";
import { buildTeamContext } from "@/lib/ai/context/team-context";

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

    // Build team context
    const teamContext = await buildTeamContext(organizationId);

    if (!teamContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Organization not found");
    }

    if (teamContext.membersWithStrengths < 2) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "At least 2 team members need strength profiles for gap analysis"
      );
    }

    // Build analysis data for the prompt
    const gapAnalysisData = {
      domainDistribution: teamContext.domainDistribution.map((d) => ({
        domain: d.name,
        percentage: d.percentage,
        memberCount: d.members.length,
      })),
      gaps: teamContext.gaps,
      underrepresentedThemes: teamContext.underrepresentedThemes.slice(0, 15),
      topThemes: teamContext.topThemes.slice(0, 10).map((t) => ({
        name: t.name,
        domain: t.domain,
        count: t.count,
      })),
      teamSize: teamContext.memberCount,
      membersWithStrengths: teamContext.membersWithStrengths,
    };

    // Build system prompt
    const systemPrompt = `You are a CliftonStrengths consultant specializing in team composition analysis.

Your role is to analyze team strength gaps and provide actionable recommendations that:
1. Are specific and practical for the team's context
2. Consider both hiring strategies and internal development
3. Suggest ways to leverage existing strengths to cover gaps
4. Prioritize recommendations by impact

The four CliftonStrengths domains and their impact:
- **Executing** (task completion, follow-through, reliability): Achiever, Arranger, Belief, Consistency, Deliberative, Discipline, Focus, Responsibility, Restorative
- **Influencing** (persuasion, communication, driving action): Activator, Command, Communication, Competition, Maximizer, Self-Assurance, Significance, Woo
- **Relationship Building** (team cohesion, trust, collaboration): Adaptability, Connectedness, Developer, Empathy, Harmony, Includer, Individualization, Positivity, Relator
- **Strategic Thinking** (analysis, planning, decision-making): Analytical, Context, Futuristic, Ideation, Input, Intellection, Learner, Strategic

Return your response as a JSON object with this structure:
{
  "summary": "Brief overview of the team's gap situation (1-2 sentences)",
  "recommendations": [
    {
      "priority": 1-3 (1 is highest),
      "title": "Short recommendation title",
      "description": "Detailed explanation and action steps",
      "type": "hire|develop|partner|process",
      "impact": "What will improve when this is addressed"
    }
  ],
  "quickWins": ["List of 2-3 things the team can do immediately"]
}`;

    // Build user prompt
    const userPrompt = `Analyze the following team composition and provide gap recommendations:

**Team Stats:**
- Team size: ${gapAnalysisData.teamSize} members
- Members with strength profiles: ${gapAnalysisData.membersWithStrengths}

**Domain Distribution:**
${gapAnalysisData.domainDistribution.map((d) => `- ${d.domain}: ${d.percentage}% (${d.memberCount} members)`).join("\n")}

**Identified Gaps:**
${gapAnalysisData.gaps.length > 0
  ? gapAnalysisData.gaps.map((g) => `- ${g.domain} (${g.gapType}): ${g.recommendation}`).join("\n")
  : "No significant gaps identified"}

**Top Team Strengths:**
${gapAnalysisData.topThemes.map((t) => `- ${t.name} (${t.domain}): ${t.count} members`).join("\n")}

**Missing/Underrepresented Themes:**
${gapAnalysisData.underrepresentedThemes.slice(0, 10).join(", ")}

Provide 3-5 prioritized recommendations with practical action steps. Return only valid JSON.`;

    // Generate recommendations
    const result = await generate({
      memberId,
      organizationId,
      feature: "gap-recommendations",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Gap Recommendations] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to generate recommendations"
      );
    }

    // Parse the JSON response
    let recommendations;
    try {
      let cleanedResponse = (result.data || "").trim();
      // Remove markdown code blocks if present
      if (cleanedResponse.startsWith("```json")) {
        cleanedResponse = cleanedResponse.slice(7);
      } else if (cleanedResponse.startsWith("```")) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith("```")) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      cleanedResponse = cleanedResponse.trim();

      recommendations = JSON.parse(cleanedResponse);
    } catch {
      console.warn("[AI Gap Recommendations] Failed to parse JSON, returning raw text");
      recommendations = {
        summary: "Analysis complete",
        recommendations: [{
          priority: 1,
          title: "Gap Analysis",
          description: result.data,
          type: "develop",
          impact: "Improved team balance",
        }],
        quickWins: [],
      };
    }

    console.log(`[AI Gap Recommendations] Generated recommendations for org ${organizationId}`);

    return apiSuccess({
      ...recommendations,
      teamStats: {
        memberCount: teamContext.memberCount,
        membersWithStrengths: teamContext.membersWithStrengths,
        domainDistribution: teamContext.domainDistribution.map((d) => ({
          name: d.name,
          slug: d.slug,
          percentage: d.percentage,
        })),
        gapCount: teamContext.gaps.length,
      },
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Gap Recommendations Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate gap recommendations");
  }
}
