import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { generate, checkAIReady, getMinimalUserContext } from "@/lib/ai";

const recognitionStartersSchema = z.object({
  recipientId: z.string(),
  context: z.string().optional(), // e.g., "project completion", "team meeting", etc.
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
    const validation = recognitionStartersSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { recipientId, context } = validation.data;

    // Get recipient's context
    const recipientContext = await getMinimalUserContext(recipientId);

    if (!recipientContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "Recipient not found");
    }

    const systemPrompt = `You are a recognition message helper for a CliftonStrengths-based team collaboration app called StrengthSync.
Generate 4 diverse starter phrases for recognizing someone that:
1. Reference their specific CliftonStrengths when appropriate
2. Are specific enough to be meaningful but open-ended enough to complete
3. Cover different types of recognition (appreciation, achievement, teamwork, growth)
4. Sound natural and genuine, not formulaic

Return a JSON array of 4 objects, each with:
- starter: The opening phrase (10-20 words, ending with "...")
- theme: The related CliftonStrength theme name (or null if general)
- category: One of "appreciation", "achievement", "teamwork", "growth"`;

    let userPrompt = `Generate recognition starters for ${recipientContext.name}.

Their top CliftonStrengths: ${recipientContext.topStrengths.join(", ")}`;

    if (recipientContext.dominantDomain) {
      userPrompt += `\nDominant domain: ${recipientContext.dominantDomain}`;
    }

    if (context) {
      userPrompt += `\nContext: ${context}`;
    }

    userPrompt += `\n\nReturn 4 recognition starters as a JSON array.`;

    const result = await generate({
      memberId,
      organizationId,
      feature: "recognition-starters",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Recognition Starters] Generation failed:", result.error);
      return apiError(ApiErrorCode.INTERNAL_ERROR, result.error || "Failed to generate starters");
    }

    // Parse the JSON response
    let starters;
    try {
      const jsonMatch = result.data?.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        starters = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: create simple starters
        starters = [
          { starter: `I want to recognize ${recipientContext.name} for...`, theme: null, category: "appreciation" },
          { starter: `${recipientContext.name} showed great ${recipientContext.topStrengths[0] || "skill"} when...`, theme: recipientContext.topStrengths[0] || null, category: "achievement" },
        ];
      }
    } catch {
      starters = [
        { starter: `I want to recognize ${recipientContext.name} for...`, theme: null, category: "appreciation" },
      ];
    }

    console.log(`[AI Recognition Starters] Generated starters for recipient ${recipientId}`);

    return apiSuccess({
      starters,
      recipient: {
        name: recipientContext.name,
        topStrengths: recipientContext.topStrengths,
      },
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Recognition Starters Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate recognition starters");
  }
}
