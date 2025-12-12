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

const teamNarrativeSchema = z.object({
  style: z.enum(["brief", "detailed", "executive"]).optional().default("detailed"),
  focusArea: z.enum(["strengths", "gaps", "collaboration", "all"]).optional().default("all"),
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
    const validation = teamNarrativeSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { style, focusArea } = validation.data;

    // Build team context
    const teamContext = await buildTeamContext(organizationId);

    if (!teamContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Organization not found");
    }

    if (teamContext.membersWithStrengths < 2) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "At least 2 team members need strength profiles to generate a narrative"
      );
    }

    // Format context for the prompt
    const contextString = formatTeamContextForPrompt(teamContext);

    // Build system prompt based on style
    let systemPrompt = `You are a CliftonStrengths consultant and team dynamics expert for StrengthSync, a team collaboration app.

Your role is to analyze team composition data and generate insightful narratives that:
1. Help teams understand their collective strengths profile
2. Identify opportunities for better collaboration
3. Highlight areas where the team excels and areas for development
4. Use CliftonStrengths terminology correctly and meaningfully

The four CliftonStrengths domains are:
- **Executing**: People who make things happen (Achiever, Arranger, Belief, Consistency, Deliberative, Discipline, Focus, Responsibility, Restorative)
- **Influencing**: People who take charge and help others be heard (Activator, Command, Communication, Competition, Maximizer, Self-Assurance, Significance, Woo)
- **Relationship Building**: People who build strong relationships that hold teams together (Adaptability, Connectedness, Developer, Empathy, Harmony, Includer, Individualization, Positivity, Relator)
- **Strategic Thinking**: People who analyze information to make better decisions (Analytical, Context, Futuristic, Ideation, Input, Intellection, Learner, Strategic)

Write in a warm, professional tone. Be specific with your insights.`;

    // Adjust for style
    if (style === "brief") {
      systemPrompt += "\n\nKeep your response to 2-3 sentences maximum.";
    } else if (style === "executive") {
      systemPrompt += "\n\nFormat as an executive summary with clear bullet points and actionable insights.";
    } else {
      systemPrompt += "\n\nProvide a comprehensive narrative (3-5 paragraphs) that tells the story of this team's strengths.";
    }

    // Build user prompt based on focus area
    let userPrompt = `Generate a team strengths narrative for the following team:\n\n${contextString}\n\n`;

    switch (focusArea) {
      case "strengths":
        userPrompt += "Focus primarily on the team's collective strengths and what makes them powerful together.";
        break;
      case "gaps":
        userPrompt += "Focus on identifying gaps and providing constructive recommendations for team development.";
        break;
      case "collaboration":
        userPrompt += "Focus on how different strengths can complement each other and suggest collaboration strategies.";
        break;
      default:
        userPrompt += "Provide a balanced analysis covering strengths, potential gaps, and collaboration opportunities.";
    }

    // Generate narrative
    const result = await generate({
      memberId,
      organizationId,
      feature: "team-narrative",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Team Narrative] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to generate team narrative"
      );
    }

    console.log(`[AI Team Narrative] Generated ${style} narrative for org ${organizationId}`);

    return apiSuccess({
      narrative: result.data,
      teamStats: {
        memberCount: teamContext.memberCount,
        membersWithStrengths: teamContext.membersWithStrengths,
        topDomains: teamContext.domainDistribution
          .sort((a, b) => b.percentage - a.percentage)
          .slice(0, 2)
          .map((d) => ({ name: d.name, percentage: d.percentage })),
        topThemes: teamContext.topThemes.slice(0, 5).map((t) => t.name),
        gapCount: teamContext.gaps.length,
      },
      style,
      focusArea,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Team Narrative Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate team narrative");
  }
}
