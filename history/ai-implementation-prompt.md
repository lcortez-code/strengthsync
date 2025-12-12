# AI Integration Implementation Prompt

## Context

You are implementing AI features for StrengthSync, a CliftonStrengths-based team collaboration app. The implementation plan is documented in `history/aiplan.md` and all tasks are tracked in beads.

## Your Mission

Implement the complete AI integration using Vercel AI SDK with OpenAI GPT-4o. Work through each phase systematically, claiming tasks in beads before starting and closing them when complete.

## Key Resources

- **Implementation Plan:** `history/aiplan.md` - Contains detailed code examples and architecture
- **Issue Tracker:** Use `bd` commands to manage tasks
- **Tech Stack:** Next.js 15, Prisma, NextAuth, Tailwind CSS

## Workflow

For each task:
1. Check ready work: `bd ready --json`
2. Claim the task: `bd update <id> --status in_progress`
3. Implement following the plan in `history/aiplan.md`
4. Test the implementation
5. Close the task: `bd close <id> --reason "Completed: <brief description>"`
6. Commit code and `.beads/issues.jsonl` together

## Phase 1: Foundation (Priority 1)

**Epic:** `strengthsync-waq` - AI Foundation

Complete these tasks in order:

### 1. Install Dependencies
**Task:** `strengthsync-hvg`
```bash
npm install ai @ai-sdk/openai
```
Add to `.env`:
```
OPENAI_API_KEY=sk-...
```

### 2. Database Schema
**Task:** `strengthsync-93p`
Add AI models to `prisma/schema.prisma`:
- AIConversation
- AIMessage
- AIPromptTemplate
- AIUsageLog

Then run: `npm run db:push`

### 3. AI Client Configuration
**Task:** `strengthsync-fl7`
Create `src/lib/ai/client.ts` with OpenAI client setup.

### 4. Rate Limiter
**Task:** `strengthsync-c3k`
Create `src/lib/ai/rate-limiter.ts`

### 5. Token Tracker
**Task:** `strengthsync-rwp`
Create `src/lib/ai/token-tracker.ts`

### 6. User Context Builder
**Task:** `strengthsync-pfj`
Create `src/lib/ai/context/user-context.ts`

### 7. Team Context Builder
**Task:** `strengthsync-oxl`
Create `src/lib/ai/context/team-context.ts`

### 8. Prompt Template Engine
**Task:** `strengthsync-0mz`
Create `src/lib/ai/prompts/template-engine.ts`

### 9. Main AI Service
**Task:** `strengthsync-vdc`
Create `src/lib/ai/service.ts` and `src/lib/ai/index.ts`

---

## Phase 2: Writing Assistance (Priority 2)

**Epic:** `strengthsync-mty`

### Shoutout Enhancement
- **API:** `strengthsync-1ta` → `src/app/api/ai/enhance-shoutout/route.ts`
- **UI:** `strengthsync-2ws` → Add AI button to `src/app/shoutouts/create/page.tsx`

### Skill Request Improvement
- **API:** `strengthsync-nc9` → `src/app/api/ai/improve-skill-request/route.ts`
- **UI:** `strengthsync-tti` → Add to `src/app/marketplace/create/page.tsx`

### Profile Bio Generation
- **API:** `strengthsync-jwv` → `src/app/api/ai/generate-bio/route.ts`
- **UI:** `strengthsync-d4t` → Add to `src/app/settings/profile/page.tsx`

### Recognition Starters
- **API:** `strengthsync-tkr` → `src/app/api/ai/recognition-starters/route.ts`

---

## Phase 3: Insights & Analytics (Priority 2)

**Epic:** `strengthsync-nvf`

### Team Narrative
- **API:** `strengthsync-3as` → `src/app/api/ai/team-narrative/route.ts`
- **Component:** `strengthsync-dyr` → `src/components/team/TeamNarrative.tsx`

### Gap Recommendations
- **API:** `strengthsync-ku5` → `src/app/api/ai/gap-recommendations/route.ts`
- **Enhance:** `strengthsync-9hw` → `src/components/team/GapAnalysisCard.tsx`

### Development Insights
- **API:** `strengthsync-jaq` → `src/app/api/ai/development-insights/route.ts`
- **Component:** `strengthsync-y6n` → `src/components/strengths/DevelopmentInsights.tsx`

### Executive Summary
- **API:** `strengthsync-u40` → `src/app/api/ai/executive-summary/route.ts`
- **UI:** `strengthsync-3cj` → Add to admin dashboard

### Email Digest
- **Enhance:** `strengthsync-lui` → `src/lib/email/digest-service.ts`

---

## Phase 4: Smart Recommendations (Priority 2)

**Epic:** `strengthsync-65u`

### Partnership Reasoning
- **API:** `strengthsync-rit` → `src/app/api/ai/partnership-reasoning/route.ts`
- **Enhance:** `strengthsync-383` → `src/components/team/PartnershipSuggestions.tsx`

### Mentorship Guide
- **API:** `strengthsync-6tm` → `src/app/api/ai/mentorship-guide/route.ts`
- **UI:** `strengthsync-ikp` → Add to mentorship page

### Skill Request Matching
- **API:** `strengthsync-0uz` → `src/app/api/ai/match-skill-request/route.ts`

### Recognition Prompts
- **API:** `strengthsync-css` → `src/app/api/ai/recognition-prompts/route.ts`
- **Component:** `strengthsync-r6n` → `src/components/notifications/RecognitionPrompt.tsx`

### Goal Suggestions
- **API:** `strengthsync-cfx` → `src/app/api/ai/goals/suggest/route.ts`

---

## Phase 5: Chat Interface (Priority 2)

**Epic:** `strengthsync-qje`

### Chat API with Tools
- **API:** `strengthsync-4b8` → `src/app/api/ai/chat/route.ts`
- **Tools:** `strengthsync-3fe` → `src/lib/ai/tools/`

### Chat UI
- **Page:** `strengthsync-2k4` → `src/app/chat/page.tsx`
- **Layout:** `strengthsync-1b7` → `src/app/chat/layout.tsx`
- **Nav:** `strengthsync-hv5` → Add link to DashboardLayout

---

## Phase 6: Admin & Components (Priority 3)

**Epic:** `strengthsync-1x4`

### Admin Dashboard
- **Usage:** `strengthsync-1s9` → `src/app/admin/ai/page.tsx`
- **Prompts:** `strengthsync-3k2` → `src/app/admin/ai/prompts/page.tsx`

### Reusable Components
- `strengthsync-5h8` → `src/components/ai/AIEnhanceButton.tsx`
- `strengthsync-9tt` → `src/components/ai/StreamingText.tsx`
- `strengthsync-0go` → `src/components/ai/AIFeedback.tsx`
- `strengthsync-5py` → `src/components/ai/AILoadingState.tsx`

### Custom Hooks
- `strengthsync-86w` → `src/components/ai/hooks/useAIChat.ts`
- `strengthsync-r5c` → `src/components/ai/hooks/useAIGenerate.ts`

---

## Code Standards

Follow the existing codebase patterns:
- Use `apiSuccess`, `apiError`, `ApiErrorCode` from `@/lib/api/response`
- Use Zod for request validation
- Include proper error handling with try/catch
- Add console logging for debugging
- Follow the Next.js 15 App Router patterns (await params)
- Use streaming (`streamText`) for interactive features
- Use non-streaming (`generateText`) for short responses

## Testing

After each feature:
1. Test the API endpoint directly
2. Test the UI integration
3. Verify error handling
4. Check rate limiting works

## Commit Strategy

Commit after completing each epic or logical group of tasks:
```bash
git add . && git commit -m "feat: Add AI foundation infrastructure

- Install Vercel AI SDK and OpenAI provider
- Add AI database models (conversations, messages, templates, usage)
- Implement AI service with rate limiting and token tracking
- Create user and team context builders
- Set up prompt template engine

Closes: strengthsync-waq, strengthsync-hvg, strengthsync-93p, strengthsync-fl7,
        strengthsync-c3k, strengthsync-rwp, strengthsync-pfj, strengthsync-oxl,
        strengthsync-0mz, strengthsync-vdc

🤖 Generated with Claude Code"
```

## Getting Started

```bash
# Check what's ready to work on
bd ready -p 1 --json

# Start with dependencies
bd update strengthsync-hvg --status in_progress

# Reference the detailed plan
cat history/aiplan.md
```

Begin implementation now. Start with Phase 1 Foundation tasks.
