import { generateText, streamText, generateObject, zodSchema, CoreMessage } from "ai";
import { z } from "zod";
import { openai, getFeatureSettings, AIFeature, isAIConfigured } from "./client";
import { reserveAIRequest, estimateTokenAllowance, RateLimitResult } from "./rate-limiter";
import { logUsage, TokenUsage } from "./token-tracker";
import { getPromptTemplate, renderTemplate, TemplateVariables } from "./prompts";
import { prisma } from "@/lib/prisma";

export interface AIServiceOptions {
  memberId: string;
  organizationId: string;
  feature: AIFeature;
}

export interface GenerateOptions extends AIServiceOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateFromTemplateOptions extends AIServiceOptions {
  templateName: string;
  variables: TemplateVariables;
}

export interface StreamOptions extends AIServiceOptions {
  messages: CoreMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  onFinish?: (usage: TokenUsage) => void;
}

export interface AIServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: TokenUsage;
  rateLimitResult?: RateLimitResult;
}

// Check if AI is ready to use
export function checkAIReady(): { ready: boolean; reason?: string } {
  if (!isAIConfigured()) {
    return { ready: false, reason: "OPENAI_API_KEY not configured" };
  }
  return { ready: true };
}

// Generate text (non-streaming)
export async function generate(
  options: GenerateOptions
): Promise<AIServiceResult<string>> {
  const startTime = Date.now();
  const { memberId, organizationId, feature, prompt, systemPrompt } = options;

  // Check if AI is configured
  const aiReady = checkAIReady();
  if (!aiReady.ready) {
    return { success: false, error: aiReady.reason };
  }

  const settings = getFeatureSettings(feature);
  const temperature = options.temperature ?? settings.temperature;
  const maxTokens = options.maxTokens ?? settings.maxTokens;
  const admission = await reserveAIRequest({
    memberId, organizationId, feature, endpoint: `/api/ai/${feature}`, model: settings.model,
    reservedTokens: estimateTokenAllowance({ system: systemPrompt, prompt }, maxTokens),
  });
  if (!admission.allowed || !admission.reservationId) {
    return { success: false, error: admission.reason, rateLimitResult: admission };
  }

  try {
    const result = await generateText({
      model: openai(settings.model),
      system: systemPrompt,
      prompt,
      temperature,
      maxOutputTokens: maxTokens,
      maxRetries: 0,
    });

    const latencyMs = Date.now() - startTime;
    const promptTokens = result.usage.inputTokens ?? 0;
    const completionTokens = result.usage.outputTokens ?? 0;
    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      model: settings.model,
      latencyMs,
    };

    // Log usage
    await logUsage({
      reservationId: admission.reservationId,
      memberId,
      organizationId,
      feature,
      endpoint: `/api/ai/${feature}`,
      usage,
      usageKnown: result.usage.inputTokens != null && result.usage.outputTokens != null,
      success: true,
    });

    console.log(`[AI Service] Generated response for ${feature} in ${latencyMs}ms`);

    return {
      success: true,
      data: result.text,
      usage,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = "AI generation failed. Please try again later.";

    // Log failed attempt
    await logUsage({
      reservationId: admission.reservationId,
      memberId,
      organizationId,
      feature,
      endpoint: `/api/ai/${feature}`,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        model: settings.model,
        latencyMs,
      },
      usageKnown: false,
      success: false,
      errorMessage,
    });

    console.error(`[AI Service] Generation failed for ${feature}`);
    return { success: false, error: errorMessage };
  }
}

// Generate from a template
export async function generateFromTemplate(
  options: GenerateFromTemplateOptions
): Promise<AIServiceResult<string>> {
  const template = await getPromptTemplate(options.templateName);

  if (!template) {
    return { success: false, error: `Template '${options.templateName}' not found` };
  }

  const renderedPrompt = renderTemplate(template.userPrompt, options.variables);
  const renderedSystem = renderTemplate(template.systemPrompt, options.variables);

  return generate({
    ...options,
    prompt: renderedPrompt,
    systemPrompt: renderedSystem,
    temperature: template.temperature,
    maxTokens: template.maxTokens,
  });
}

// Generate structured output with Zod schema
export async function generateStructured<T extends z.ZodType>(
  options: GenerateOptions & { schema: T; schemaName?: string }
): Promise<AIServiceResult<z.infer<T>>> {
  const startTime = Date.now();
  const { memberId, organizationId, feature, prompt, systemPrompt, schema } = options;

  const aiReady = checkAIReady();
  if (!aiReady.ready) {
    return { success: false, error: aiReady.reason };
  }

  const settings = getFeatureSettings(feature);
  const maxTokens = options.maxTokens ?? settings.maxTokens;
  const admission = await reserveAIRequest({
    memberId, organizationId, feature, endpoint: `/api/ai/${feature}`, model: settings.model,
    reservedTokens: estimateTokenAllowance({ system: systemPrompt, prompt, schema: zodSchema(schema).jsonSchema }, maxTokens),
  });
  if (!admission.allowed || !admission.reservationId) {
    return { success: false, error: admission.reason, rateLimitResult: admission };
  }

  try {
    const result = await generateObject({
      model: openai(settings.model),
      system: systemPrompt,
      prompt,
      schema,
      schemaName: options.schemaName,
      mode: "json", // Use JSON mode for better compatibility
      maxOutputTokens: maxTokens,
      maxRetries: 0,
    });

    const latencyMs = Date.now() - startTime;
    const genPromptTokens = result.usage.inputTokens ?? 0;
    const genCompletionTokens = result.usage.outputTokens ?? 0;
    const usage: TokenUsage = {
      promptTokens: genPromptTokens,
      completionTokens: genCompletionTokens,
      totalTokens: genPromptTokens + genCompletionTokens,
      model: settings.model,
      latencyMs,
    };

    await logUsage({
      reservationId: admission.reservationId,
      memberId,
      organizationId,
      feature,
      endpoint: `/api/ai/${feature}`,
      usage,
      usageKnown: result.usage.inputTokens != null && result.usage.outputTokens != null,
      success: true,
    });

    return {
      success: true,
      data: result.object,
      usage,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = "AI generation failed. Please try again later.";

    await logUsage({
      reservationId: admission.reservationId,
      memberId,
      organizationId,
      feature,
      endpoint: `/api/ai/${feature}`,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        model: settings.model,
        latencyMs,
      },
      usageKnown: false,
      success: false,
      errorMessage,
    });

    console.error(`[AI Service] Structured generation failed for ${feature}`);
    return { success: false, error: errorMessage };
  }
}

// Stream text response
export async function stream(options: StreamOptions) {
  const startTime = Date.now();
  const { memberId, organizationId, feature, messages, systemPrompt, onFinish } = options;

  const aiReady = checkAIReady();
  if (!aiReady.ready) {
    throw new Error(aiReady.reason);
  }

  if (!messages.every((message) => typeof message.content === "string")) {
    throw new Error("AI streaming supports text messages only");
  }

  const settings = getFeatureSettings(feature);
  const maxTokens = options.maxTokens ?? settings.maxTokens;
  const admission = await reserveAIRequest({
    memberId, organizationId, feature, endpoint: `/api/ai/${feature}`, model: settings.model,
    reservedTokens: estimateTokenAllowance({ system: systemPrompt, messages }, maxTokens),
  });
  if (!admission.allowed || !admission.reservationId) throw new Error(admission.reason);
  const reservationId = admission.reservationId;

  const recordIncomplete = async () => {
    await logUsage({
      reservationId, memberId, organizationId, feature, endpoint: `/api/ai/${feature}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: settings.model, latencyMs: Date.now() - startTime },
      usageKnown: false,
      success: false, errorMessage: "Generation did not complete; allowance retained",
    });
  };

  try {
    const result = streamText({
      model: openai(settings.model),
      system: systemPrompt,
      messages,
      temperature: options.temperature ?? settings.temperature,
      maxOutputTokens: maxTokens,
      maxRetries: 0,
      onError: recordIncomplete,
      onAbort: recordIncomplete,
      onFinish: async ({ usage, text }) => {
        const latencyMs = Date.now() - startTime;
        const streamPromptTokens = usage.inputTokens ?? 0;
        const streamCompletionTokens = usage.outputTokens ?? 0;
        const tokenUsage: TokenUsage = {
          promptTokens: streamPromptTokens,
          completionTokens: streamCompletionTokens,
          totalTokens: streamPromptTokens + streamCompletionTokens,
          model: settings.model,
          latencyMs,
        };

        await logUsage({
          reservationId,
          memberId,
          organizationId,
          feature,
          endpoint: `/api/ai/${feature}`,
          usage: tokenUsage,
          usageKnown: usage.inputTokens != null && usage.outputTokens != null,
          success: true,
        });

        onFinish?.(tokenUsage);
      },
    });

    return result;
  } catch (error) {
    await recordIncomplete();
    throw error;
  }
}

// Chat service for conversation management
export class ChatService {
  private memberId: string;
  private organizationId: string;
  private conversationId: string | null = null;
  private creatingConversation: Promise<string> | null = null;

  constructor(memberId: string, organizationId: string, conversationId?: string) {
    this.memberId = memberId;
    this.organizationId = organizationId;
    this.conversationId = conversationId || null;
  }

  private conversationScope() {
    return {
      id: this.conversationId || "",
      memberId: this.memberId,
      organizationId: this.organizationId,
      status: "ACTIVE" as const,
      member: { organizationId: this.organizationId, status: "ACTIVE" as const },
    };
  }

  // Create or get conversation
  async getOrCreateConversation(title?: string): Promise<string> {
    if (this.conversationId) {
      const conversation = await prisma.aIConversation.findFirst({
        where: this.conversationScope(), select: { id: true },
      });
      if (!conversation) throw new Error("Conversation is unavailable or no longer accessible");
      return this.conversationId;
    }

    // Share creation across concurrent calls on this instance and keep membership
    // active until the new conversation commits.
    if (!this.creatingConversation) {
      this.creatingConversation = prisma.$transaction(async (tx) => {
        const members = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "organization_members"
          WHERE "id" = ${this.memberId} AND "organizationId" = ${this.organizationId} AND "status" = 'ACTIVE'
          FOR SHARE
        `;
        if (members.length !== 1) throw new Error("Active organization membership is required");
        const conversation = await tx.aIConversation.create({
          data: { memberId: this.memberId, organizationId: this.organizationId, title: title || "New conversation" },
          select: { id: true },
        });
        return conversation.id;
      }).then((id) => { this.conversationId = id; return id; });
    }
    try { return await this.creatingConversation; }
    finally { this.creatingConversation = null; }
  }

  // Get conversation history
  async getMessages(): Promise<CoreMessage[]> {
    if (!this.conversationId) {
      return [];
    }

    await this.getOrCreateConversation();
    const messages = await prisma.aIMessage.findMany({
      // Keep authorization in the history query in case access changed after the check.
      where: { conversationId: this.conversationId, conversation: this.conversationScope() },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });

    return messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant" | "system",
      content: m.content,
    }));
  }

  // Save a message to the conversation
  async saveMessage(
    role: "USER" | "ASSISTANT" | "SYSTEM",
    content: string,
    usage?: Partial<TokenUsage>
  ): Promise<void> {
    const conversationId = await this.getOrCreateConversation();
    await prisma.$transaction(async (tx) => {
      const members = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "organization_members"
        WHERE "id" = ${this.memberId} AND "organizationId" = ${this.organizationId} AND "status" = 'ACTIVE'
        FOR SHARE
      `;
      if (members.length !== 1) throw new Error("Active organization membership is required");
      // This conditional write locks the owned conversation until message creation
      // completes, preventing deletion or reassignment between authorization and save.
      const writable = await tx.aIConversation.updateMany({
        where: this.conversationScope(), data: { updatedAt: new Date() },
      });
      if (writable.count !== 1) throw new Error("Conversation is unavailable or no longer accessible");
      await tx.aIMessage.create({
        data: {
          conversationId, role, content,
          promptTokens: usage?.promptTokens || 0,
          completionTokens: usage?.completionTokens || 0,
          totalTokens: usage?.totalTokens || 0,
          model: usage?.model, latencyMs: usage?.latencyMs,
        },
      });
    });
  }

  // Stream a chat response
  async streamChat(
    userMessage: string,
    systemPrompt?: string
  ) {
    // Save user message
    await this.saveMessage("USER", userMessage);

    // Get conversation history
    const history = await this.getMessages();

    // Stream response
    const result = await stream({
      memberId: this.memberId,
      organizationId: this.organizationId,
      feature: "chat",
      messages: history,
      systemPrompt,
      onFinish: async (usage) => {
        // Response will be saved by the caller using the full text
      },
    });

    return result;
  }

  // Save assistant response after streaming completes
  async saveAssistantResponse(content: string, usage?: TokenUsage): Promise<void> {
    await this.saveMessage("ASSISTANT", content, usage);
  }
}

// Create a new chat service instance
export function createChatService(
  memberId: string,
  organizationId: string,
  conversationId?: string
): ChatService {
  return new ChatService(memberId, organizationId, conversationId);
}
