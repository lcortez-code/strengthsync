import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { generateStructured, checkAIReady } from "@/lib/ai";
import { buildUserContext } from "@/lib/ai/context/user-context";
import { THEMES } from "@/constants/strengths-data";

const goalSuggestSchema = z.object({
  targetMemberId: z.string().min(1, "Target member ID is required"),
  category: z
    .enum(["PERFORMANCE", "DEVELOPMENT", "STRENGTHS_APPLICATION", "COLLABORATION", "LEADERSHIP"])
    .optional(),
  count: z.number().min(1).max(5).optional().default(3),
  context: z.string().optional(), // Additional context like role, current projects, etc.
});

// Structured output for goal suggestions
const goalSuggestionsOutputSchema = z.object({
  goals: z.array(
    z.object({
      title: z.string().describe("Clear, actionable goal title"),
      description: z.string().describe("Detailed description of what success looks like"),
      category: z
        .enum(["PERFORMANCE", "DEVELOPMENT", "STRENGTHS_APPLICATION", "COLLABORATION", "LEADERSHIP"])
        .describe("Goal category"),
      alignedThemes: z.array(z.string()).describe("CliftonStrengths themes this goal aligns with (1-3)"),
      suggestedActions: z
        .array(z.string())
        .describe("3-4 specific action items to achieve this goal"),
      measurableOutcomes: z
        .array(z.string())
        .describe("2-3 ways to measure success"),
      timeframe: z.string().describe("Suggested timeframe (e.g., 'Q1', '3 months', '6 months')"),
      difficultyLevel: z
        .enum(["stretch", "achievable", "foundational"])
        .describe("How challenging this goal is"),
    })
  ),
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
    const validation = goalSuggestSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { targetMemberId, category, count, context } = validation.data;

    // Build context for the target member
    const targetContext = await buildUserContext(targetMemberId);

    if (!targetContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Target member not found");
    }

    if (targetContext.topStrengths.length === 0) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "Target member needs a strength profile for personalized goal suggestions"
      );
    }

    // Get theme details for richer context
    const themeDetails = targetContext.topStrengths.map((s) => {
      const theme = THEMES.find((t) => t.name === s.name);
      return {
        name: s.name,
        domain: s.domain,
        actionItems: theme?.actionItems || [],
        blindSpots: theme?.blindSpots || [],
        worksWith: theme?.worksWith || [],
      };
    });

    // Calculate domain balance
    const domainCounts: Record<string, number> = {};
    for (const s of targetContext.topStrengths) {
      domainCounts[s.domain] = (domainCounts[s.domain] || 0) + 1;
    }

    const systemPrompt = `You are a strengths-based performance coach for StrengthSync.

Your role is to suggest development goals that leverage and develop CliftonStrengths.

Key principles for strengths-based goal setting:
1. **Lead with strengths** - Goals should primarily leverage existing strengths, not "fix" weaknesses
2. **Aim up and over** - Help people invest more in what they naturally do well
3. **Be specific and measurable** - Goals should be SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
4. **Balance domains** - Consider all four domains but focus on strengths
5. **Connect to themes** - Every goal should clearly align with 1-3 CliftonStrengths

Goal Categories:
- **PERFORMANCE**: Job-specific deliverables and results
- **DEVELOPMENT**: Learning new skills or deepening expertise
- **STRENGTHS_APPLICATION**: Using strengths in new ways or contexts
- **COLLABORATION**: Working effectively with others
- **LEADERSHIP**: Leading others, projects, or initiatives

The four CliftonStrengths domains:
- **Executing**: Make things happen (action, follow-through, results)
- **Influencing**: Move others to action (persuasion, selling, energizing)
- **Relationship Building**: Connect people (trust, collaboration, team cohesion)
- **Strategic Thinking**: Analyze and plan (strategy, innovation, problem-solving)`;

    let userPrompt = `Suggest ${count} personalized development goals for:

**${targetContext.fullName}**
${targetContext.jobTitle ? `Role: ${targetContext.jobTitle}` : ""}
${targetContext.department ? `Department: ${targetContext.department}` : ""}

**CliftonStrengths Profile:**
${themeDetails.map((t, i) => `${i + 1}. ${t.name} (${t.domain})
   - Natural behaviors: ${t.actionItems.slice(0, 2).join("; ")}
   - Watch for: ${t.blindSpots[0] || "N/A"}
   - Works well with: ${t.worksWith.slice(0, 3).join(", ")}`).join("\n")}

**Domain Balance:**
${Object.entries(domainCounts)
  .map(([domain, count]) => `- ${domain}: ${count}/5`)
  .join("\n")}
Dominant Domain: ${targetContext.dominantDomain || "Balanced"}

**Recent Activity:**
- Shoutouts given: ${targetContext.recentActivity.shoutoutsGiven}
- Shoutouts received: ${targetContext.recentActivity.shoutoutsReceived}
- Skill requests helped: ${targetContext.recentActivity.skillRequestsHelped}
- Challenges completed: ${targetContext.recentActivity.challengesCompleted}`;

    if (category) {
      userPrompt += `\n\n**Focus Area:** Generate ${category.replace("_", " ").toLowerCase()} goals specifically.`;
    }

    if (context) {
      userPrompt += `\n\n**Additional Context:** ${context}`;
    }

    userPrompt += `\n\nGenerate goals that:
1. Play to their natural strengths (not weaknesses)
2. Are specific enough to be actionable
3. Include measurable outcomes
4. Connect clearly to their CliftonStrengths themes
5. Vary in difficulty level (mix of stretch, achievable, foundational)`;

    const result = await generateStructured({
      memberId,
      organizationId,
      feature: "goal-suggestions",
      prompt: userPrompt,
      systemPrompt,
      schema: goalSuggestionsOutputSchema,
      schemaName: "goal_suggestions",
    });

    if (!result.success) {
      console.error("[AI Goal Suggestions] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to generate goal suggestions"
      );
    }

    console.log(`[AI Goal Suggestions] Generated ${result.data?.goals.length || 0} goals for ${targetMemberId}`);

    return apiSuccess({
      goals: result.data?.goals || [],
      targetMember: {
        id: targetMemberId,
        name: targetContext.fullName,
        topStrengths: targetContext.topStrengths.map((s) => s.name),
        dominantDomain: targetContext.dominantDomain,
      },
      requestedCategory: category || "all",
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Goal Suggestions Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate goal suggestions");
  }
}
