import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { generateStructured, checkAIReady } from "@/lib/ai";
import { buildUserContext } from "@/lib/ai/context/user-context";
import { THEMES } from "@/constants/strengths-data";
import { prisma } from "@/lib/prisma";

const mentorshipGuideSchema = z.object({
  mentorshipId: z.string().min(1, "Mentorship ID is required"),
  mentorId: z.string().min(1, "Mentor ID is required"),
  menteeId: z.string().min(1, "Mentee ID is required"),
  focusThemes: z.array(z.string()).optional(), // Specific themes to focus on
  duration: z.enum(["short", "medium", "long"]).optional().default("medium"), // Mentorship length
});

// Structured output schema for mentorship guide
const mentorshipGuideOutputSchema = z.object({
  overview: z.string().describe("Brief overview of why this pairing works (2-3 sentences)"),
  focusAreas: z.array(
    z.object({
      area: z.string().describe("Focus area name"),
      description: z.string().describe("Why this area matters for this pairing"),
      mentorStrength: z.string().describe("Which mentor strength applies"),
      menteeGoal: z.string().describe("What the mentee can develop"),
    })
  ).describe("3-4 recommended focus areas for the mentorship"),
  discussionTopics: z.array(
    z.object({
      topic: z.string().describe("Discussion topic title"),
      questions: z.array(z.string()).describe("2-3 guiding questions"),
      expectedOutcome: z.string().describe("What insight or growth this enables"),
    })
  ).describe("5-6 discussion topics for mentoring sessions"),
  activities: z.array(
    z.object({
      name: z.string().describe("Activity name"),
      description: z.string().describe("What to do"),
      duration: z.string().describe("How long it takes"),
      strengthsConnection: z.string().describe("How it relates to their strengths"),
    })
  ).describe("3-4 hands-on activities or exercises"),
  checkpoints: z.array(
    z.object({
      milestone: z.string().describe("What to achieve"),
      timeframe: z.string().describe("When to check (e.g., 'Week 2', 'Month 1')"),
      indicators: z.array(z.string()).describe("2-3 success indicators"),
    })
  ).describe("3-4 progress checkpoints"),
  watchOuts: z.array(z.string()).describe("2-3 potential challenges to be aware of"),
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
    const validation = mentorshipGuideSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { mentorshipId, mentorId, menteeId, focusThemes, duration } = validation.data;

    // Build context for both members
    const [mentorContext, menteeContext] = await Promise.all([
      buildUserContext(mentorId),
      buildUserContext(menteeId),
    ]);

    if (!mentorContext || !menteeContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Mentor or mentee not found");
    }

    if (mentorContext.topStrengths.length === 0 || menteeContext.topStrengths.length === 0) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "Both mentor and mentee need strength profiles for personalized guidance"
      );
    }

    // Get theme details for deeper insights
    const getThemeDetails = (themeName: string) => {
      const theme = THEMES.find((t) => t.name === themeName);
      return {
        name: themeName,
        blindSpots: theme?.blindSpots || [],
        actionItems: theme?.actionItems || [],
        worksWith: theme?.worksWith || [],
      };
    };

    const mentorThemeDetails = mentorContext.topStrengths.map((s) => ({
      ...s,
      ...getThemeDetails(s.name),
    }));

    const menteeThemeDetails = menteeContext.topStrengths.map((s) => ({
      ...s,
      ...getThemeDetails(s.name),
    }));

    // Find complementary and similar themes
    const mentorThemeNames = new Set(mentorContext.topStrengths.map((s) => s.name));
    const menteeThemeNames = new Set(menteeContext.topStrengths.map((s) => s.name));
    const sharedThemes = [...mentorThemeNames].filter((t) => menteeThemeNames.has(t));
    const mentorUnique = [...mentorThemeNames].filter((t) => !menteeThemeNames.has(t));
    const menteeUnique = [...menteeThemeNames].filter((t) => !mentorThemeNames.has(t));

    const durationGuide = {
      short: "1-2 months, meeting weekly",
      medium: "3-6 months, meeting bi-weekly",
      long: "6-12 months, meeting monthly",
    };

    const systemPrompt = `You are a CliftonStrengths-certified coach and mentorship program designer for StrengthSync.

Your role is to create personalized mentorship guides that leverage both mentor and mentee strengths for meaningful growth.

The four CliftonStrengths domains are:
- **Executing**: Make things happen (Achiever, Arranger, Belief, Consistency, Deliberative, Discipline, Focus, Responsibility, Restorative)
- **Influencing**: Take charge and persuade (Activator, Command, Communication, Competition, Maximizer, Self-Assurance, Significance, Woo)
- **Relationship Building**: Build strong bonds (Adaptability, Connectedness, Developer, Empathy, Harmony, Includer, Individualization, Positivity, Relator)
- **Strategic Thinking**: Analyze and plan (Analytical, Context, Futuristic, Ideation, Input, Intellection, Learner, Strategic)

Key principles:
1. Leverage what the mentor does naturally (their strengths)
2. Help the mentee develop their existing strengths, not "fix" weaknesses
3. Create activities that play to both people's strengths
4. Focus on practical, actionable guidance
5. Include measurable progress indicators`;

    let userPrompt = `Create a comprehensive mentorship guide for this pairing:

**MENTOR: ${mentorContext.fullName}**
${mentorContext.jobTitle ? `Role: ${mentorContext.jobTitle}` : ""}
Top Strengths:
${mentorThemeDetails.map((t, i) => `${i + 1}. ${t.name} (${t.domain})
   - Action items they naturally do: ${t.actionItems.slice(0, 2).join("; ")}
   - Watch out for: ${t.blindSpots[0] || "N/A"}`).join("\n")}
Dominant Domain: ${mentorContext.dominantDomain || "Balanced"}
Recent mentoring activity: ${mentorContext.recentActivity.shoutoutsGiven} shoutouts given

**MENTEE: ${menteeContext.fullName}**
${menteeContext.jobTitle ? `Role: ${menteeContext.jobTitle}` : ""}
Top Strengths:
${menteeThemeDetails.map((t, i) => `${i + 1}. ${t.name} (${t.domain})
   - Areas to develop: ${t.actionItems.slice(0, 2).join("; ")}
   - Potential blind spots: ${t.blindSpots[0] || "N/A"}`).join("\n")}
Dominant Domain: ${menteeContext.dominantDomain || "Balanced"}

**STRENGTH OVERLAP ANALYSIS:**
- Shared themes (can model excellence): ${sharedThemes.length > 0 ? sharedThemes.join(", ") : "None - complementary pairing"}
- Mentor can share: ${mentorUnique.join(", ")}
- Mentee brings: ${menteeUnique.join(", ")}

**MENTORSHIP PARAMETERS:**
- Duration: ${durationGuide[duration]}`;

    if (focusThemes && focusThemes.length > 0) {
      userPrompt += `\n- Requested focus themes: ${focusThemes.join(", ")}`;
    }

    userPrompt += `\n\nGenerate a strengths-based mentorship guide that creates meaningful growth opportunities.`;

    const result = await generateStructured({
      memberId,
      organizationId,
      feature: "mentorship-guide",
      prompt: userPrompt,
      systemPrompt,
      schema: mentorshipGuideOutputSchema,
      schemaName: "mentorship_guide",
    });

    if (!result.success) {
      console.error("[AI Mentorship Guide] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to generate mentorship guide"
      );
    }

    // Save the guide to the database
    await prisma.mentorship.update({
      where: { id: mentorshipId },
      data: { guide: JSON.parse(JSON.stringify(result.data)) },
    });

    console.log(`[AI Mentorship Guide] Generated and saved guide for ${mentorContext.fullName} -> ${menteeContext.fullName}`);

    return apiSuccess({
      guide: result.data,
      pairing: {
        mentor: {
          id: mentorId,
          name: mentorContext.fullName,
          topStrengths: mentorContext.topStrengths.map((s) => s.name),
          dominantDomain: mentorContext.dominantDomain,
        },
        mentee: {
          id: menteeId,
          name: menteeContext.fullName,
          topStrengths: menteeContext.topStrengths.map((s) => s.name),
          dominantDomain: menteeContext.dominantDomain,
        },
        sharedThemes,
        duration,
      },
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Mentorship Guide Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate mentorship guide");
  }
}
