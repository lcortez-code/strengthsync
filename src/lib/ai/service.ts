import { generateText, streamText, generateObject, CoreMessage } from "ai";
import { z } from "zod";
import { openai, getFeatureSettings, AIFeature, isAIConfigured } from "./client";
import { checkAllLimits, RateLimitResult } from "./rate-limiter";
import { logUsage, TokenUsage } from "./token-tracker";
import { getPromptTemplate, renderTemplate, TemplateVariables } from "./prompts";
import { prisma } from "@/lib/prisma";

export interface AIServiceOptions {
  memberId: string;
  organizationId: string;
  feature: AIFeature;
  skipRateLimitCheck?: boolean;
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

  // Check rate limits
  if (!options.skipRateLimitCheck) {
    const rateLimitResult = await checkAllLimits(memberId, organizationId);
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: rateLimitResult.reason,
        rateLimitResult,
      };
    }
  }

  const settings = getFeatureSettings(feature);
  const temperature = options.temperature ?? settings.temperature;
  const maxTokens = options.maxTokens ?? settings.maxTokens;

  try {
    const result = await generateText({
      model: openai(settings.model),
      system: systemPrompt,
      prompt,
      temperature,
      maxOutputTokens: maxTokens,
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
      memberId,
      organizationId,
      feature,
      endpoint: `/api/ai/${feature}`,
      usage,
      requestSummary: prompt.substring(0, 200),
      responseSummary: result.text.substring(0, 200),
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log failed attempt
    await logUsage({
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
      requestSummary: prompt.substring(0, 200),
      success: false,
      errorMessage,
    });

    console.error(`[AI Service] Error in ${feature}:`, error);
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

  if (!options.skipRateLimitCheck) {
    const rateLimitResult = await checkAllLimits(memberId, organizationId);
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: rateLimitResult.reason,
        rateLimitResult,
      };
    }
  }

  const settings = getFeatureSettings(feature);

  try {
    const result = await generateObject({
      model: openai(settings.model),
      system: systemPrompt,
      prompt,
      schema,
      schemaName: options.schemaName,
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
      memberId,
      organizationId,
      feature,
      endpoint: `/api/ai/${feature}`,
      usage,
      requestSummary: prompt.substring(0, 200),
      responseSummary: JSON.stringify(result.object).substring(0, 200),
      success: true,
    });

    return {
      success: true,
      data: result.object,
      usage,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await logUsage({
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
      success: false,
      errorMessage,
    });

    console.error(`[AI Service] Structured generation error in ${feature}:`, error);
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

  if (!options.skipRateLimitCheck) {
    const rateLimitResult = await checkAllLimits(memberId, organizationId);
    if (!rateLimitResult.allowed) {
      throw new Error(rateLimitResult.reason);
    }
  }

  const settings = getFeatureSettings(feature);

  const result = streamText({
    model: openai(settings.model),
    system: systemPrompt,
    messages,
    temperature: options.temperature ?? settings.temperature,
    maxOutputTokens: options.maxTokens ?? settings.maxTokens,
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
        memberId,
        organizationId,
        feature,
        endpoint: `/api/ai/${feature}`,
        usage: tokenUsage,
        responseSummary: text.substring(0, 200),
        success: true,
      });

      onFinish?.(tokenUsage);
    },
  });

  return result;
}

// Chat service for conversation management
export class ChatService {
  private memberId: string;
  private organizationId: string;
  private conversationId: string | null = null;

  constructor(memberId: string, organizationId: string, conversationId?: string) {
    this.memberId = memberId;
    this.organizationId = organizationId;
    this.conversationId = conversationId || null;
  }

  // Create or get conversation
  async getOrCreateConversation(title?: string): Promise<string> {
    if (this.conversationId) {
      return this.conversationId;
    }

    const conversation = await prisma.aIConversation.create({
      data: {
        memberId: this.memberId,
        organizationId: this.organizationId,
        title: title || "New conversation",
      },
    });

    this.conversationId = conversation.id;
    return conversation.id;
  }

  // Get conversation history
  async getMessages(): Promise<CoreMessage[]> {
    if (!this.conversationId) {
      return [];
    }

    const messages = await prisma.aIMessage.findMany({
      where: { conversationId: this.conversationId },
      orderBy: { createdAt: "asc" },
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
    if (!this.conversationId) {
      await this.getOrCreateConversation();
    }

    await prisma.aIMessage.create({
      data: {
        conversationId: this.conversationId!,
        role,
        content,
        promptTokens: usage?.promptTokens || 0,
        completionTokens: usage?.completionTokens || 0,
        totalTokens: usage?.totalTokens || 0,
        model: usage?.model,
        latencyMs: usage?.latencyMs,
      },
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
