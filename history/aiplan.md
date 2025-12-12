# AI Integration Plan for StrengthSync

## Overview

This document outlines the implementation plan for integrating AI capabilities into StrengthSync using Vercel AI SDK with OpenAI GPT-4o. The plan is organized by epics with detailed task breakdowns.

---

## Phase 1: Foundation (Priority 1)

**Epic:** `strengthsync-waq` - AI Foundation: Set up Vercel AI SDK and OpenAI integration

### Tasks

#### 1.1 Install Dependencies
**ID:** `strengthsync-hvg`
```bash
npm install ai @ai-sdk/openai
```

**Environment Variables (.env):**
```env
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...  # Optional
```

---

#### 1.2 Database Schema
**ID:** `strengthsync-93p`
**File:** `prisma/schema.prisma`

Add models:
```prisma
model AIConversation {
  id             String             @id @default(cuid())
  memberId       String
  member         OrganizationMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  organizationId String
  title          String?
  context        AIConversationContext
  status         ConversationStatus @default(ACTIVE)
  messages       AIMessage[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([memberId, createdAt(sort: Desc)])
  @@map("ai_conversations")
}

enum AIConversationContext {
  COACHING
  SHOUTOUT_HELP
  REVIEW_ASSISTANT
  GOAL_PLANNING
  TEAM_INSIGHTS
  GENERAL
}

enum ConversationStatus {
  ACTIVE
  ARCHIVED
  DELETED
}

model AIMessage {
  id               String         @id @default(cuid())
  conversationId   String
  conversation     AIConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role             MessageRole
  content          String         @db.Text
  promptTokens     Int?
  completionTokens Int?
  totalTokens      Int?
  toolCalls        Json?
  toolResults      Json?
  createdAt        DateTime @default(now())

  @@index([conversationId, createdAt])
  @@map("ai_messages")
}

enum MessageRole {
  SYSTEM
  USER
  ASSISTANT
  TOOL
}

model AIPromptTemplate {
  id            String         @id @default(cuid())
  slug          String         @unique
  name          String
  description   String?
  category      PromptCategory
  systemPrompt  String         @db.Text
  userTemplate  String         @db.Text
  version       Int            @default(1)
  isActive      Boolean        @default(true)
  isDefault     Boolean        @default(false)
  modelId       String         @default("gpt-4o")
  temperature   Float          @default(0.7)
  maxTokens     Int            @default(1000)
  configuration Json           @default("{}")
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@index([category, isActive])
  @@map("ai_prompt_templates")
}

enum PromptCategory {
  SHOUTOUT
  COACHING
  REVIEW
  GOALS
  INSIGHTS
  PARTNERSHIP
  GENERAL
}

model AIUsageLog {
  id                 String   @id @default(cuid())
  organizationId     String
  memberId           String?
  endpoint           String
  promptSlug         String?
  modelId            String
  promptTokens       Int
  completionTokens   Int
  totalTokens        Int
  estimatedCostMicro Int      @default(0)
  latencyMs          Int
  success            Boolean
  errorCode          String?
  createdAt          DateTime @default(now())

  @@index([organizationId, createdAt(sort: Desc)])
  @@index([memberId, createdAt(sort: Desc)])
  @@map("ai_usage_logs")
}
```

---

#### 1.3 AI Client Configuration
**ID:** `strengthsync-fl7`
**File:** `src/lib/ai/client.ts`

```typescript
import { createOpenAI } from "@ai-sdk/openai";

export function createAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  return createOpenAI({
    apiKey,
    organization: process.env.OPENAI_ORG_ID,
    compatibility: "strict",
  });
}

export const AI_MODELS = {
  GPT4O: "gpt-4o",
  GPT4O_MINI: "gpt-4o-mini",
} as const;

export type AIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

export const MODEL_DEFAULTS = {
  chat: AI_MODELS.GPT4O,
  quickGeneration: AI_MODELS.GPT4O_MINI,
  complexAnalysis: AI_MODELS.GPT4O,
  structuredOutput: AI_MODELS.GPT4O,
} as const;

// Token pricing (per 1K tokens in microdollars)
export const TOKEN_PRICING: Record<AIModel, { input: number; output: number }> = {
  "gpt-4o": { input: 2500, output: 10000 },
  "gpt-4o-mini": { input: 150, output: 600 },
};
```

---

#### 1.4 Rate Limiter
**ID:** `strengthsync-c3k`
**File:** `src/lib/ai/rate-limiter.ts`

```typescript
import { prisma } from "@/lib/prisma";

interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  tokensPerDay: number;
}

const DEFAULT_LIMITS: RateLimitConfig = {
  requestsPerMinute: 10,
  requestsPerHour: 100,
  tokensPerDay: 50000,
};

export class RateLimiter {
  private requestCounts = new Map<string, { count: number; resetAt: number }>();

  async checkLimit(organizationId: string, memberId: string): Promise<void> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiSettings: true },
    });

    const settings = (org?.aiSettings as any) ?? {};
    if (settings.enabled === false) {
      throw new Error("AI features are disabled for this organization");
    }

    const limits = { ...DEFAULT_LIMITS, ...settings.rateLimits };

    // Check minute limit
    const minuteKey = `${memberId}:minute`;
    await this.checkInMemoryLimit(minuteKey, limits.requestsPerMinute, 60 * 1000);

    // Check daily token limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayUsage = await prisma.aIUsageLog.aggregate({
      where: { organizationId, createdAt: { gte: todayStart } },
      _sum: { totalTokens: true },
    });

    const dailyLimit = (settings.monthlyTokenLimit ?? 1000000) / 30;
    if ((todayUsage._sum.totalTokens ?? 0) >= dailyLimit) {
      throw new Error("Daily AI token limit reached");
    }
  }

  private async checkInMemoryLimit(key: string, limit: number, windowMs: number): Promise<void> {
    const now = Date.now();
    const entry = this.requestCounts.get(key);

    if (!entry || now >= entry.resetAt) {
      this.requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    if (entry.count >= limit) {
      const waitSeconds = Math.ceil((entry.resetAt - now) / 1000);
      throw new Error(`Rate limit exceeded. Please wait ${waitSeconds} seconds.`);
    }

    entry.count++;
  }
}
```

---

#### 1.5 Token Tracker
**ID:** `strengthsync-rwp`
**File:** `src/lib/ai/token-tracker.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { TOKEN_PRICING, type AIModel } from "./client";

interface TrackUsageParams {
  organizationId: string;
  memberId: string;
  endpoint: string;
  promptSlug?: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}

export class TokenTracker {
  async trackUsage(params: TrackUsageParams): Promise<void> {
    const totalTokens = params.promptTokens + params.completionTokens;
    const pricing = TOKEN_PRICING[params.modelId as AIModel] ?? TOKEN_PRICING["gpt-4o"];
    const estimatedCostMicro = Math.round(
      (params.promptTokens / 1000) * pricing.input +
      (params.completionTokens / 1000) * pricing.output
    );

    await prisma.aIUsageLog.create({
      data: {
        ...params,
        totalTokens,
        estimatedCostMicro,
      },
    });
  }
}
```

---

#### 1.6 User Context Builder
**ID:** `strengthsync-pfj`
**File:** `src/lib/ai/context/user-context.ts`

```typescript
import { prisma } from "@/lib/prisma";

export interface UserContextData {
  userContextSummary: string;
  userName: string;
  topStrengths: string;
  domainProfile: string;
}

export async function buildUserContext(memberId: string): Promise<UserContextData> {
  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    include: {
      user: { select: { fullName: true, jobTitle: true, bio: true } },
      strengths: {
        include: { theme: { include: { domain: true } } },
        orderBy: { rank: "asc" },
        take: 10,
      },
      shoutoutsReceived: {
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { theme: true, giver: { include: { user: true } } },
      },
    },
  });

  if (!member) {
    return {
      userContextSummary: "No user context available.",
      userName: "Unknown",
      topStrengths: "Not available",
      domainProfile: "Not available",
    };
  }

  const top5 = member.strengths.slice(0, 5);
  const topStrengths = top5
    .map((s, i) => `${i + 1}. ${s.theme.name} (${s.theme.domain.name})`)
    .join("\n");

  const domainCounts: Record<string, number> = {};
  top5.forEach((s) => {
    domainCounts[s.theme.domain.name] = (domainCounts[s.theme.domain.name] || 0) + 1;
  });
  const domainProfile = Object.entries(domainCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([d, c]) => `${d}: ${c}`)
    .join(", ");

  return {
    userContextSummary: `User: ${member.user.fullName}\nRole: ${member.user.jobTitle || "N/A"}\n\nTop 5 Strengths:\n${topStrengths}\n\nDomain Focus: ${domainProfile}`,
    userName: member.user.fullName,
    topStrengths,
    domainProfile,
  };
}
```

---

#### 1.7 Team Context Builder
**ID:** `strengthsync-oxl`
**File:** `src/lib/ai/context/team-context.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { calculateDomainComposition, analyzeGaps } from "@/lib/strengths/analytics";

export async function buildTeamContext(organizationId: string) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      user: { select: { fullName: true } },
      strengths: {
        where: { rank: { lte: 10 } },
        include: { theme: { include: { domain: true } } },
        orderBy: { rank: "asc" },
      },
    },
  });

  const memberStrengthData = members.flatMap((m) =>
    m.strengths.map((s) => ({
      memberId: m.id,
      memberName: m.user.fullName,
      themeSlug: s.theme.slug,
      themeName: s.theme.name,
      domain: s.theme.domain.slug as any,
      rank: s.rank,
    }))
  );

  const domainComposition = calculateDomainComposition(memberStrengthData, members.length);
  const gapAnalysis = analyzeGaps(memberStrengthData, members.length);

  return {
    teamContextSummary: `Team Size: ${members.length}\nDomain Balance: ${domainComposition.map(d => `${d.domainName}: ${d.percentage}%`).join(", ")}\n\nGaps: ${gapAnalysis.recommendations.slice(0, 3).join("; ")}`,
    teamSize: members.length.toString(),
    domainBalance: domainComposition.map(d => `${d.domainName}: ${d.percentage}%`).join(", "),
  };
}
```

---

#### 1.8 Prompt Template Engine
**ID:** `strengthsync-0mz`
**File:** `src/lib/ai/prompts/template-engine.ts`

```typescript
import { prisma } from "@/lib/prisma";

export interface PromptTemplate {
  slug: string;
  systemPrompt: string;
  userTemplate: string;
  temperature?: number;
  maxTokens?: number;
}

const templateCache = new Map<string, { template: PromptTemplate; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function getPromptTemplate(slug: string): Promise<PromptTemplate | null> {
  const cached = templateCache.get(slug);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.template;
  }

  const dbTemplate = await prisma.aIPromptTemplate.findFirst({
    where: { slug, isActive: true },
    orderBy: { version: "desc" },
  });

  if (dbTemplate) {
    const template: PromptTemplate = {
      slug: dbTemplate.slug,
      systemPrompt: dbTemplate.systemPrompt,
      userTemplate: dbTemplate.userTemplate,
      temperature: dbTemplate.temperature,
      maxTokens: dbTemplate.maxTokens,
    };
    templateCache.set(slug, { template, cachedAt: Date.now() });
    return template;
  }

  return HARDCODED_TEMPLATES[slug] || null;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? _);
}

const HARDCODED_TEMPLATES: Record<string, PromptTemplate> = {
  "shoutout-generator": {
    slug: "shoutout-generator",
    systemPrompt: `You are a recognition writing assistant for CliftonStrengths-based peer recognition.
Help craft meaningful, specific shoutouts that highlight how a colleague demonstrated their strengths.
Keep shoutouts 50-150 words. Be specific about impact. Use warm, professional tone.

User's Strengths Profile:
{{userContextSummary}}`,
    userTemplate: `Help me write a shoutout for {{recipientName}} (strengths: {{recipientStrengths}}).
Context: {{situation}}
Generate 2-3 options.`,
    temperature: 0.8,
    maxTokens: 500,
  },
  // Add more templates as needed
};
```

---

#### 1.9 Main AI Service
**ID:** `strengthsync-vdc`
**File:** `src/lib/ai/service.ts`

```typescript
import { generateText, streamText, type CoreMessage } from "ai";
import { createAIClient, MODEL_DEFAULTS, type AIModel } from "./client";
import { RateLimiter } from "./rate-limiter";
import { TokenTracker } from "./token-tracker";
import { buildUserContext, buildTeamContext } from "./context";
import { getPromptTemplate, renderTemplate } from "./prompts";

export interface GenerateOptions {
  organizationId: string;
  memberId: string;
  promptSlug: string;
  variables?: Record<string, string>;
  model?: AIModel;
  includeUserContext?: boolean;
  includeTeamContext?: boolean;
}

export class AIService {
  private openai = createAIClient();
  private rateLimiter = new RateLimiter();
  private tokenTracker = new TokenTracker();

  async generate(options: GenerateOptions) {
    await this.rateLimiter.checkLimit(options.organizationId, options.memberId);

    const template = await getPromptTemplate(options.promptSlug);
    if (!template) throw new Error(`Template not found: ${options.promptSlug}`);

    let contextVars = { ...options.variables };
    if (options.includeUserContext) {
      const ctx = await buildUserContext(options.memberId);
      contextVars = { ...contextVars, ...ctx };
    }
    if (options.includeTeamContext) {
      const ctx = await buildTeamContext(options.organizationId);
      contextVars = { ...contextVars, ...ctx };
    }

    const systemPrompt = renderTemplate(template.systemPrompt, contextVars);
    const userPrompt = renderTemplate(template.userTemplate, contextVars);
    const model = options.model ?? MODEL_DEFAULTS.quickGeneration;

    const startTime = Date.now();
    const result = await generateText({
      model: this.openai(model),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: template.temperature ?? 0.7,
      maxTokens: template.maxTokens ?? 1000,
    });

    await this.tokenTracker.trackUsage({
      organizationId: options.organizationId,
      memberId: options.memberId,
      endpoint: "generate",
      promptSlug: options.promptSlug,
      modelId: model,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      latencyMs: Date.now() - startTime,
      success: true,
    });

    return { text: result.text, usage: result.usage };
  }

  async streamChat(options: {
    organizationId: string;
    memberId: string;
    messages: CoreMessage[];
    systemPrompt?: string;
    model?: AIModel;
  }) {
    await this.rateLimiter.checkLimit(options.organizationId, options.memberId);

    const userContext = await buildUserContext(options.memberId);
    const fullSystem = `${options.systemPrompt ?? ""}\n\n## User Context\n${userContext.userContextSummary}`;

    const result = await streamText({
      model: this.openai(options.model ?? MODEL_DEFAULTS.chat),
      system: fullSystem,
      messages: options.messages,
      temperature: 0.7,
      maxTokens: 2000,
    });

    return result.toDataStreamResponse();
  }
}

export const aiService = new AIService();
```

---

## Phase 2: Writing Assistance (Priority 2)

**Epic:** `strengthsync-mty` - AI Writing Assistance

### Tasks

| ID | Task | File |
|----|------|------|
| `strengthsync-1ta` | Shoutout enhancement API | `src/app/api/ai/enhance-shoutout/route.ts` |
| `strengthsync-2ws` | Add AI button to shoutout page | `src/app/shoutouts/create/page.tsx` |
| `strengthsync-nc9` | Skill request improvement API | `src/app/api/ai/improve-skill-request/route.ts` |
| `strengthsync-tti` | Add AI button to marketplace | `src/app/marketplace/create/page.tsx` |
| `strengthsync-jwv` | Profile bio generation API | `src/app/api/ai/generate-bio/route.ts` |
| `strengthsync-d4t` | Add bio button to settings | `src/app/settings/profile/page.tsx` |
| `strengthsync-tkr` | Recognition starters API | `src/app/api/ai/recognition-starters/route.ts` |

---

## Phase 3: Insights & Analytics (Priority 2)

**Epic:** `strengthsync-nvf` - AI Insights & Analytics

### Tasks

| ID | Task | File |
|----|------|------|
| `strengthsync-3as` | Team narrative API | `src/app/api/ai/team-narrative/route.ts` |
| `strengthsync-dyr` | TeamNarrative component | `src/components/team/TeamNarrative.tsx` |
| `strengthsync-ku5` | Gap recommendations API | `src/app/api/ai/gap-recommendations/route.ts` |
| `strengthsync-9hw` | Enhance GapAnalysisCard | `src/components/team/GapAnalysisCard.tsx` |
| `strengthsync-jaq` | Development insights API | `src/app/api/ai/development-insights/route.ts` |
| `strengthsync-y6n` | DevelopmentInsights component | `src/components/strengths/DevelopmentInsights.tsx` |
| `strengthsync-u40` | Executive summary API | `src/app/api/ai/executive-summary/route.ts` |
| `strengthsync-3cj` | Add to admin dashboard | `src/app/admin/dashboard/page.tsx` |
| `strengthsync-lui` | Email digest narratives | `src/lib/email/digest-service.ts` |

---

## Phase 4: Smart Recommendations (Priority 2)

**Epic:** `strengthsync-65u` - AI Smart Recommendations

### Tasks

| ID | Task | File |
|----|------|------|
| `strengthsync-rit` | Partnership reasoning API | `src/app/api/ai/partnership-reasoning/route.ts` |
| `strengthsync-383` | Enhance PartnershipSuggestions | `src/components/team/PartnershipSuggestions.tsx` |
| `strengthsync-6tm` | Mentorship guide API | `src/app/api/ai/mentorship-guide/route.ts` |
| `strengthsync-ikp` | Add to mentorship page | `src/app/mentorship/page.tsx` |
| `strengthsync-0uz` | Skill request matcher API | `src/app/api/ai/match-skill-request/route.ts` |
| `strengthsync-css` | Recognition prompts API | `src/app/api/ai/recognition-prompts/route.ts` |
| `strengthsync-r6n` | RecognitionPrompt component | `src/components/notifications/RecognitionPrompt.tsx` |
| `strengthsync-cfx` | Goal suggestions API | `src/app/api/ai/goals/suggest/route.ts` |

---

## Phase 5: Chat Interface (Priority 2)

**Epic:** `strengthsync-qje` - AI Chat Interface

### Tasks

| ID | Task | File |
|----|------|------|
| `strengthsync-4b8` | Streaming chat API | `src/app/api/ai/chat/route.ts` |
| `strengthsync-3fe` | AI tools implementation | `src/lib/ai/tools/` |
| `strengthsync-2k4` | Chat page | `src/app/chat/page.tsx` |
| `strengthsync-1b7` | Chat layout | `src/app/chat/layout.tsx` |
| `strengthsync-hv5` | Add to navigation | `src/components/layout/DashboardLayout.tsx` |

---

## Phase 6: Admin & Components (Priority 3)

**Epic:** `strengthsync-1x4` - AI Admin & Polish

### Tasks

| ID | Task | File |
|----|------|------|
| `strengthsync-1s9` | Usage dashboard | `src/app/admin/ai/page.tsx` |
| `strengthsync-3k2` | Prompt template UI | `src/app/admin/ai/prompts/page.tsx` |
| `strengthsync-5h8` | AIEnhanceButton | `src/components/ai/AIEnhanceButton.tsx` |
| `strengthsync-9tt` | StreamingText | `src/components/ai/StreamingText.tsx` |
| `strengthsync-0go` | AIFeedback | `src/components/ai/AIFeedback.tsx` |
| `strengthsync-5py` | AILoadingState | `src/components/ai/AILoadingState.tsx` |
| `strengthsync-86w` | useAIChat hook | `src/components/ai/hooks/useAIChat.ts` |
| `strengthsync-r5c` | useAIGenerate hook | `src/components/ai/hooks/useAIGenerate.ts` |

---

## File Structure

```
src/lib/ai/
├── index.ts              # Public exports
├── client.ts             # OpenAI client config
├── service.ts            # Main AI service
├── rate-limiter.ts       # Rate limiting
├── token-tracker.ts      # Usage tracking
├── context/
│   ├── index.ts
│   ├── user-context.ts
│   └── team-context.ts
├── prompts/
│   ├── index.ts
│   ├── template-engine.ts
│   └── system-prompts.ts
└── tools/
    ├── index.ts
    ├── search-members.ts
    └── explain-strength.ts

src/app/api/ai/
├── chat/route.ts
├── enhance-shoutout/route.ts
├── improve-skill-request/route.ts
├── generate-bio/route.ts
├── recognition-starters/route.ts
├── team-narrative/route.ts
├── gap-recommendations/route.ts
├── development-insights/route.ts
├── executive-summary/route.ts
├── partnership-reasoning/route.ts
├── mentorship-guide/route.ts
├── match-skill-request/route.ts
├── recognition-prompts/route.ts
└── goals/suggest/route.ts

src/app/chat/
├── page.tsx
└── layout.tsx

src/components/ai/
├── AIEnhanceButton.tsx
├── StreamingText.tsx
├── AIFeedback.tsx
├── AILoadingState.tsx
└── hooks/
    ├── useAIChat.ts
    └── useAIGenerate.ts
```

---

## Cost Estimates

| Feature | Input Tokens | Output Tokens | Est. Cost/Call |
|---------|--------------|---------------|----------------|
| Shoutout enhance | ~500 | ~300 | $0.004 |
| Team narrative | ~1,500 | ~500 | $0.01 |
| Executive summary | ~3,000 | ~1,000 | $0.02 |
| Chat message | ~2,000 | ~500 | $0.012 |

**Cost controls:**
- Cache team narratives (24h)
- Rate limit: 50 AI calls/user/day
- Use gpt-4o-mini for simple tasks

---

## Implementation Order

1. **Week 1-2**: Foundation (Phase 1)
2. **Week 3-4**: Shoutout Enhancement (highest value)
3. **Week 5-6**: Team Narrative & Gap Analysis
4. **Week 7-8**: Chat Interface
5. **Week 9-10**: Remaining features based on feedback
