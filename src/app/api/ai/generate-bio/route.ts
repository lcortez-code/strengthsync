import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { generate, checkAIReady, getMinimalUserContext } from "@/lib/ai";

const generateBioSchema = z.object({
  style: z.enum(["professional", "casual", "leadership"]),
  interests: z.array(z.string()).optional(),
  additionalContext: z.string().optional(),
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
    const validation = generateBioSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { style, interests, additionalContext } = validation.data;

    // Get user's full context
    const userContext = await getMinimalUserContext(memberId);

    if (!userContext) {
      return apiError(ApiErrorCode.NOT_FOUND, "User profile not found");
    }

    const styleInstructions = {
      professional: "Write in a formal, professional tone suitable for LinkedIn or company directory. Focus on expertise and competencies.",
      casual: "Write in a friendly, approachable tone. Make it personable and relatable while still highlighting strengths.",
      leadership: "Write in a confident, visionary tone that emphasizes leadership qualities and ability to inspire others.",
    };

    const systemPrompt = `You are a professional bio writer who incorporates CliftonStrengths into compelling personal narratives.
Write bios that are:
1. Authentic and personable
2. Strengths-focused without being jargon-heavy
3. Appropriate for the chosen tone
4. Concise but impactful (2-3 sentences max)

${styleInstructions[style]}

Return ONLY the bio text, nothing else.`;

    let userPrompt = `Write a ${style} bio for ${userContext.name}.

Top CliftonStrengths: ${userContext.topStrengths.join(", ")}`;

    if (userContext.dominantDomain) {
      userPrompt += `\nDominant strength domain: ${userContext.dominantDomain}`;
    }

    if (interests && interests.length > 0) {
      userPrompt += `\nInterests: ${interests.join(", ")}`;
    }

    if (additionalContext) {
      userPrompt += `\nAdditional context: ${additionalContext}`;
    }

    const result = await generate({
      memberId,
      organizationId,
      feature: "generate-bio",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Generate Bio] Generation failed:", result.error);
      return apiError(ApiErrorCode.INTERNAL_ERROR, result.error || "Failed to generate bio");
    }

    console.log(`[AI Generate Bio] Generated ${style} bio for member ${memberId}`);

    return apiSuccess({
      bio: result.data?.trim(),
      style,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Generate Bio Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate bio");
  }
}
