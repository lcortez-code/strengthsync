import { createOpenAI } from "@ai-sdk/openai";

// Initialize OpenAI client with Vercel AI SDK
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// Model configurations
export const AI_MODELS = {
  // Primary model for complex tasks
  PRIMARY: "gpt-4o",
  // Faster, cheaper model for simple tasks
  FAST: "gpt-4o-mini",
  // For embeddings (future use)
  EMBEDDING: "text-embedding-3-small",
} as const;

export type AIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

// Model pricing per 1M tokens (in cents)
export const MODEL_PRICING = {
  "gpt-4o": {
    input: 250, // $2.50 per 1M input tokens
    output: 1000, // $10.00 per 1M output tokens
  },
  "gpt-4o-mini": {
    input: 15, // $0.15 per 1M input tokens
    output: 60, // $0.60 per 1M output tokens
  },
  "text-embedding-3-small": {
    input: 2, // $0.02 per 1M tokens
    output: 0,
  },
} as const;

// Calculate cost in cents from token usage
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!pricing) {
    console.warn(`Unknown model pricing for: ${model}`);
    return 0;
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  // Return cost in cents, rounded to 4 decimal places
  return Math.round((inputCost + outputCost) * 10000) / 10000;
}

// Default generation settings
export const DEFAULT_SETTINGS = {
  temperature: 0.7,
  maxTokens: 1000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
} as const;

// Feature-specific settings
export const FEATURE_SETTINGS = {
  "enhance-shoutout": {
    model: AI_MODELS.FAST,
    temperature: 0.8,
    maxTokens: 500,
  },
  "improve-skill-request": {
    model: AI_MODELS.FAST,
    temperature: 0.7,
    maxTokens: 600,
  },
  "generate-bio": {
    model: AI_MODELS.FAST,
    temperature: 0.8,
    maxTokens: 300,
  },
  "recognition-starters": {
    model: AI_MODELS.FAST,
    temperature: 0.9,
    maxTokens: 400,
  },
  "team-narrative": {
    model: AI_MODELS.PRIMARY,
    temperature: 0.7,
    maxTokens: 1500,
  },
  "gap-recommendations": {
    model: AI_MODELS.PRIMARY,
    temperature: 0.6,
    maxTokens: 1200,
  },
  "development-insights": {
    model: AI_MODELS.PRIMARY,
    temperature: 0.7,
    maxTokens: 1000,
  },
  "executive-summary": {
    model: AI_MODELS.PRIMARY,
    temperature: 0.6,
    maxTokens: 2000,
  },
  "partnership-reasoning": {
    model: AI_MODELS.FAST,
    temperature: 0.7,
    maxTokens: 500,
  },
  "mentorship-guide": {
    model: AI_MODELS.PRIMARY,
    temperature: 0.7,
    maxTokens: 800,
  },
  "match-skill-request": {
    model: AI_MODELS.FAST,
    temperature: 0.5,
    maxTokens: 600,
  },
  "recognition-prompts": {
    model: AI_MODELS.FAST,
    temperature: 0.8,
    maxTokens: 400,
  },
  "goal-suggestions": {
    model: AI_MODELS.PRIMARY,
    temperature: 0.7,
    maxTokens: 800,
  },
  chat: {
    model: AI_MODELS.PRIMARY,
    temperature: 0.7,
    maxTokens: 1500,
  },
} as const;

export type AIFeature = keyof typeof FEATURE_SETTINGS;

// Get settings for a specific feature
export function getFeatureSettings(feature: AIFeature) {
  return {
    ...DEFAULT_SETTINGS,
    ...FEATURE_SETTINGS[feature],
  };
}

// Check if API key is configured
export function isAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
