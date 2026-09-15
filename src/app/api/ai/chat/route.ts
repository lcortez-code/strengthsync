import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { streamText } from "ai";
import { z } from "zod";
import { openai, checkAIReady, getFeatureSettings, reserveAIRequest, estimateTokenAllowance, logUsage } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { buildUserContext, buildTeamContext, formatTeamContextForPrompt, formatUserContextForPrompt } from "@/lib/ai/context";

const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(10000),
  }).strict()).min(1).max(100).refine(
    (messages) => messages.reduce((total, message) => total + message.content.length, 0) <= 100000,
    "Conversation is too long"
  ),
  conversationId: z.string().min(1).max(191).optional(),
}).strict();

const SYSTEM_PROMPT = `You are the StrengthSync AI Coach — a personal strengths-based development coach inside a CliftonStrengths team collaboration app.

Your primary role is to help users grow, develop, and thrive by leveraging their unique CliftonStrengths profile. Think of yourself as a supportive coach who helps people translate self-awareness into action.

You help users:
1. Build a personal development plan around their top strengths
2. Identify and manage blind spots tied to their strengths profile
3. Find team members who complement their strengths for collaboration
4. Develop daily habits and strategies that align with how they naturally think, feel, and behave
5. Navigate challenges at work by applying their strengths intentionally
6. Understand their team's strengths composition and dynamics

Guidelines:
- Be warm, encouraging, and action-oriented — always suggest concrete next steps
- Ask reflective questions to help users think deeper about their growth
- Frame feedback through a strengths lens: focus on what's strong, not what's wrong
- Use the available tools to look up real data when needed
- When mentioning strengths, explain how they show up in everyday behavior
- If you don't have enough information, ask clarifying questions
- Celebrate progress and recognize effort

Available CliftonStrengths Domains:
- Executing: Achievement-oriented themes (Achiever, Arranger, Belief, Consistency, Deliberative, Discipline, Focus, Responsibility, Restorative)
- Influencing: Themes about taking charge (Activator, Command, Communication, Competition, Maximizer, Self-Assurance, Significance, Woo)
- Relationship Building: Connection themes (Adaptability, Connectedness, Developer, Empathy, Harmony, Includer, Individualization, Positivity, Relator)
- Strategic Thinking: Analytical themes (Analytical, Context, Futuristic, Ideation, Input, Intellection, Learner, Strategic)`;

export async function POST(request: NextRequest) {
  let recordStreamFailure: ((reason: string) => Promise<void>) | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;

    if (!organizationId || !memberId) {
      return new Response(JSON.stringify({ error: "Organization membership required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const aiReady = checkAIReady();
    if (!aiReady.ready) {
      return new Response(JSON.stringify({ error: aiReady.reason }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const validation = chatRequestSchema.safeParse(await request.json());
    if (!validation.success) {
      return new Response(JSON.stringify({ error: "Provide up to 100 user or assistant text messages of at most 10,000 characters each" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { messages, conversationId } = validation.data;
    const conversationScope = {
      id: conversationId,
      memberId,
      organizationId,
      status: "ACTIVE" as const,
      member: { organizationId, status: "ACTIVE" as const },
    };
    if (conversationId) {
      const conversation = await prisma.aIConversation.findFirst({
        where: conversationScope,
        select: { id: true },
      });
      if (!conversation) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Get user and team context for personalization
    const [userContext, teamContext] = await Promise.all([
      buildUserContext(memberId, { organizationId, viewerMemberId: memberId, viewerRole: session.user.role }),
      buildTeamContext(organizationId, { viewerMemberId: memberId, viewerRole: session.user.role }),
    ]);

    // Build context-aware system prompt
    let contextPrompt = SYSTEM_PROMPT;

    if (userContext) {
      contextPrompt += `\n\n=== CURRENT USER PROFILE ===\n${formatUserContextForPrompt(userContext)}`;
    }

    if (teamContext) {
      contextPrompt += `\n\n${formatTeamContextForPrompt(teamContext)}`;

      // Add individual team member details with ALL strengths
      if (teamContext.members.length > 0) {
        contextPrompt += `\n\n**Team Members - Complete CliftonStrengths Profiles:**`;
        for (const member of teamContext.members) {
          contextPrompt += `\n\n${member.name}${member.jobTitle ? ` (${member.jobTitle})` : ""}:`;
          if (member.allStrengths.length > 0) {
            // Group strengths into sections for readability
            const top5 = member.allStrengths.filter(s => s.rank <= 5);
            const ranks6to10 = member.allStrengths.filter(s => s.rank > 5 && s.rank <= 10);
            const ranks11to20 = member.allStrengths.filter(s => s.rank > 10 && s.rank <= 20);
            const bottom14 = member.allStrengths.filter(s => s.rank > 20);

            if (top5.length > 0) {
              contextPrompt += `\n  Top 5 (Signature Themes): ${top5.map(s => `${s.rank}. ${s.name} [${s.domain}]`).join(", ")}`;
            }
            if (ranks6to10.length > 0) {
              contextPrompt += `\n  Ranks 6-10: ${ranks6to10.map(s => `${s.rank}. ${s.name}`).join(", ")}`;
            }
            if (ranks11to20.length > 0) {
              contextPrompt += `\n  Ranks 11-20: ${ranks11to20.map(s => `${s.rank}. ${s.name}`).join(", ")}`;
            }
            if (bottom14.length > 0) {
              contextPrompt += `\n  Ranks 21-34 (Lesser Themes): ${bottom14.map(s => `${s.rank}. ${s.name}`).join(", ")}`;
            }
          }
        }
      }
    }

    const settings = getFeatureSettings("chat");
    const startTime = Date.now();
    const admission = await reserveAIRequest({
      memberId,
      organizationId,
      feature: "chat",
      endpoint: "/api/ai/chat",
      model: settings.model,
      reservedTokens: estimateTokenAllowance({ system: contextPrompt, messages }, settings.maxTokens),
    });
    if (!admission.allowed || !admission.reservationId) {
      return new Response(JSON.stringify({ error: admission.reason || "AI capacity unavailable" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    const reservationId = admission.reservationId;
    let usageFinalized = false;
    recordStreamFailure = async (reason) => {
      if (usageFinalized) return;
      usageFinalized = true;
      await logUsage({
        reservationId,
        memberId,
        organizationId,
        feature: "chat",
        endpoint: "/api/ai/chat",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: settings.model, latencyMs: Date.now() - startTime },
        usageKnown: false,
        success: false,
        errorMessage: reason,
      });
    };

    // Stream the response
    const result = streamText({
      model: openai(settings.model),
      system: contextPrompt,
      messages,
      allowSystemInMessages: false,
      abortSignal: request.signal,
      experimental_download: async (assets) => {
        if (assets.length > 0) throw new Error("Chat attachments are not supported");
        return [];
      },
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
      maxRetries: 0,
      onError: async () => recordStreamFailure?.("Chat generation failed"),
      onAbort: async () => recordStreamFailure?.("Chat generation cancelled"),
      onFinish: async ({ usage, text }) => {
        if (usageFinalized) return;
        usageFinalized = true;
        const latencyMs = Date.now() - startTime;

        // Log usage
        await logUsage({
          reservationId,
          memberId,
          organizationId,
          feature: "chat",
          endpoint: "/api/ai/chat",
          usage: {
            promptTokens: usage.inputTokens ?? 0,
            completionTokens: usage.outputTokens ?? 0,
            totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            model: settings.model,
            latencyMs,
          },
          usageKnown: usage.inputTokens != null && usage.outputTokens != null,
          success: true,
        });

        // Save to conversation if ID provided
        if (conversationId) {
          const lastUserMessage = messages.filter((m) => m.role === "user").pop();
          await prisma.$transaction(async (tx) => {
            // Lock and reauthorize the conversation before persisting streamed content.
            const writable = await tx.aIConversation.updateMany({
              where: conversationScope,
              data: { updatedAt: new Date() },
            });
            if (writable.count !== 1) return;
            await tx.aIMessage.createMany({
              data: [
                ...(lastUserMessage ? [{ conversationId, role: "USER" as const, content: lastUserMessage.content }] : []),
                {
                  conversationId,
                  role: "ASSISTANT",
                  content: text,
                  promptTokens: usage.inputTokens ?? 0,
                  completionTokens: usage.outputTokens ?? 0,
                  totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
                  model: settings.model,
                  latencyMs,
                },
              ],
            });
          });
        }
      },
    });

    // Return the streaming response
    return result.toTextStreamResponse();
  } catch (error) {
    await recordStreamFailure?.("Chat generation failed").catch(() => {});
    console.error("[AI Chat] Request failed");
    return new Response(JSON.stringify({ error: "Failed to process chat" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// GET endpoint to retrieve conversation history
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const memberId = session.user.memberId;
    if (!memberId) {
      return new Response(JSON.stringify({ error: "Organization membership required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");

    if (conversationId) {
      // Get specific conversation
      const conversation = await prisma.aIConversation.findFirst({
        where: { id: conversationId, memberId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!conversation) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ data: conversation }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // List recent conversations
    const conversations = await prisma.aIConversation.findMany({
      where: { memberId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        _count: { select: { messages: true } },
      },
    });

    return new Response(JSON.stringify({ data: conversations }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[AI Chat] History request failed");
    return new Response(JSON.stringify({ error: "Failed to fetch conversations" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
