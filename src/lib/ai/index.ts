// AI Client and Configuration
export {
  openai,
  AI_MODELS,
  MODEL_PRICING,
  calculateCost,
  DEFAULT_SETTINGS,
  FEATURE_SETTINGS,
  getFeatureSettings,
  isAIConfigured,
  type AIModel,
  type AIFeature,
} from "./client";

// Rate Limiting
export {
  RATE_LIMITS,
  checkUserRateLimit,
  checkOrganizationRateLimit,
  checkTokenLimit,
  checkAllLimits,
  getUsageStats,
  type RateLimitResult,
} from "./rate-limiter";

// Token Tracking
export {
  logUsage,
  getMemberUsageSummary,
  getOrganizationUsageSummary,
  getRecentErrors,
  estimateMonthlyUsage,
  type TokenUsage,
  type UsageLogInput,
} from "./token-tracker";

// Context Builders
export {
  buildUserContext,
  formatUserContextForPrompt,
  getMinimalUserContext,
  buildTeamContext,
  formatTeamContextForPrompt,
  getMinimalTeamContext,
  getMembersWithStrengths,
  type UserContext,
  type UserStrengthContext,
  type TeamContext,
  type TeamMemberSummary,
  type DomainDistribution,
  type ThemeFrequency,
  type TeamGap,
} from "./context";

// Prompt Templates
export {
  renderTemplate,
  extractVariables,
  validateVariables,
  getPromptTemplate,
  listTemplates,
  saveTemplate,
  type TemplateVariables,
  type PromptTemplate,
} from "./prompts";

// Main AI Service
export {
  checkAIReady,
  generate,
  generateFromTemplate,
  generateStructured,
  stream,
  ChatService,
  createChatService,
  type AIServiceOptions,
  type GenerateOptions,
  type GenerateFromTemplateOptions,
  type StreamOptions,
  type AIServiceResult,
} from "./service";
