import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import {
  generate,
  checkAIReady,
  getMinimalUserContext,
} from "@/lib/ai";

const enhanceShoutoutSchema = z.object({
  message: z.string().min(10).max(2000),
  recipientId: z.string(),
  context: z.string().optional(),
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
    const validation = enhanceShoutoutSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { message, recipientId, context } = validation.data;

    // Get recipient's strengths context
    const recipientContext = await getMinimalUserContext(recipientId);
    const recipientStrengths = recipientContext?.topStrengths.join(", ") || "";
    const recipientName = recipientContext?.name || "the recipient";

    // Build the system prompt
    const systemPrompt = `You are a recognition message enhancer for a CliftonStrengths-based team collaboration app called StrengthSync.
Your role is to help users write more impactful recognition messages (shoutouts) that:
1. Connect the recognition to specific CliftonStrengths themes when relevant
2. Are genuine and specific, not generic
3. Highlight the impact of the person's contribution
4. Maintain the original sentiment and intent

Keep responses concise (2-3 sentences max). Never invent facts not present in the original message.
Return ONLY the enhanced message, nothing else.`;

    // Build the user prompt
    let userPrompt = `Please enhance this recognition message for ${recipientName}:

Original message: "${message}"`;

    if (recipientStrengths) {
      userPrompt += `

Recipient's top strengths: ${recipientStrengths}`;
    }

    if (context) {
      userPrompt += `

Additional context: ${context}`;
    }

    userPrompt += `

Provide an enhanced version that is more impactful while staying true to the original intent. Return only the enhanced message.`;

    // Generate enhanced message
    const result = await generate({
      memberId,
      organizationId,
      feature: "enhance-shoutout",
      prompt: userPrompt,
      systemPrompt,
    });

    if (!result.success) {
      console.error("[AI Enhance Shoutout] Generation failed:", result.error);
      return apiError(
        ApiErrorCode.INTERNAL_ERROR,
        result.error || "Failed to enhance message"
      );
    }

    console.log(`[AI Enhance Shoutout] Enhanced message for recipient ${recipientId}`);

    return apiSuccess({
      enhancedMessage: result.data,
      originalMessage: message,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[AI Enhance Shoutout Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to enhance shoutout");
  }
}
