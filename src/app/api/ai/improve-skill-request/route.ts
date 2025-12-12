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

const improveSkillRequestSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  domainNeeded: z.string().optional(),
  urgency: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
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
    const validation = improveSkillRequestSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { title, description, domainNeeded, urgency } = validation.data;

    // Get user context for personalization
    const userContext = await getMinimalUserContext(memberId);

    // Build the system prompt
    const systemPrompt = `You are a skill request optimizer for StrengthSync, a CliftonStrengths-based team collaboration app.

Your role is to help users write more effective skill requests that:
1. Clearly articulate what help is needed
2. Provide enough context for potential helpers to assess their fit
3. Connect to CliftonStrengths themes when relevant (Executing, Influencing, Relationship Building, Strategic Thinking)
4. Are specific about outcomes and expectations
5. Are respectful of helpers' time

Return a JSON object with two fields:
- "improvedTitle": A clearer, more engaging title (max 100 chars)
- "improvedDescription": A well-structured description (2-4 sentences)

Keep the original intent intact. Be concise and professional.`;

    // Build the user prompt
    let userPrompt = `Please improve this skill request:

Title: "${title}"
Description: "${description}"`;

    if (domainNeeded) {
      userPrompt += `
Strength domain needed: ${domainNeeded}`;
    }

    if (urgency) {
      userPrompt += `
Urgency level: ${urgency}`;
    }

    if (userContext?.topStrengths?.length) {
      userPrompt += `

Requester's top strengths: ${userContext.topStrengths.join(", ")}
(Consider mentioning complementary strengths being sought)`;
    }

    userPrompt += `

Return only a JSON object with "improvedTitle" and "improvedDescription" fields.`;

    // Generate improved content
    const result = await generate({
      memberId,
      organizationId,
      feature: "improve-skill-request",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Improve Skill Request] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to improve skill request"
      );
    }

    // Parse the JSON response
    let improved: { improvedTitle: string; improvedDescription: string };
    try {
      // Clean up the response - remove markdown code blocks if present
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

      improved = JSON.parse(cleanedResponse);
    } catch {
      // If parsing fails, return the raw text as description
      console.warn("[AI Improve Skill Request] Failed to parse JSON, using raw text");
      improved = {
        improvedTitle: title,
        improvedDescription: result.data || description,
      };
    }

    console.log(`[AI Improve Skill Request] Improved request for member ${memberId}`);

    return apiSuccess({
      improvedTitle: improved.improvedTitle || title,
      improvedDescription: improved.improvedDescription || description,
      originalTitle: title,
      originalDescription: description,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Improve Skill Request Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to improve skill request");
  }
}
