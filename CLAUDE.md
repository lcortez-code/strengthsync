# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads) for issue tracking. Use `bd` commands instead of markdown TODOs. See AGENTS.md for workflow details.

## Project Overview

**StrengthSync** is a CliftonStrengths-based team collaboration app that helps teams discover, leverage, and celebrate their unique strengths through analytics, recognition, and gamification.

**GitHub Repository**: https://github.com/freeup86/strengthsync

### Tech Stack
- **Framework**: Next.js 15 (App Router, Turbopack)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js with credentials provider (JWT strategy, 7-day sessions)
- **Styling**: Tailwind CSS with custom domain color system
- **UI**: Custom components + Radix UI primitives (AlertDialog, Dialog, Dropdown, etc.)
- **Email**: Resend for transactional emails
- **Charts**: Recharts for data visualization
- **AI**: Vercel AI SDK with OpenAI (gpt-4o-mini default) for chat/completions
- **Validation**: Zod for schema validation

## Commands

```bash
# Development
npm run dev              # Start dev server (port 3000) with Turbopack
npm run build            # Build for production
npm run lint             # Run ESLint
npm run type-check       # TypeScript type checking (tsc --noEmit)

# Database
npm run db:generate      # Generate Prisma client (also runs on postinstall)
npm run db:push          # Push schema to database
npm run db:migrate       # Run migrations (prisma migrate dev)
npm run db:seed          # Seed domains, themes, badges (npx tsx prisma/seed.ts)
npm run db:reset         # Reset database (prisma migrate reset)
npx prisma studio        # Open Prisma Studio (DB GUI)

# Docker
docker-compose up -d     # Start all services
docker-compose down      # Stop services
```

## Architecture

### Key Directories
- `src/app/` - Next.js App Router pages and API routes
- `src/app/api/` - All API endpoints (auth, team, shoutouts, challenges, etc.)
- `src/components/` - React components (ui/, layout/, strengths/, team/)
- `src/lib/` - Utilities and services:
  - `prisma.ts` - Database client singleton
  - `auth/config.ts` - NextAuth configuration
  - `api/response.ts` - Standardized API response helpers
  - `pdf/parser.ts` - CliftonStrengths PDF parsing
  - `ai/` - AI service (client, rate-limiter, token-tracker, prompts, tools)
  - `email/` - Resend email service and digest templates
  - `strengths/analytics.ts` - Team analytics calculations
- `src/constants/strengths-data.ts` - All 34 CliftonStrengths themes and 4 domains
- `prisma/schema.prisma` - Database schema (source of truth for models)

### CliftonStrengths Domain Colors
| Domain | Hex | Tailwind Classes |
|--------|-----|------------------|
| Executing | #7B68EE (Purple) | `bg-domain-executing`, `text-domain-executing` |
| Influencing | #F5A623 (Orange) | `bg-domain-influencing`, `text-domain-influencing` |
| Relationship | #4A90D9 (Blue) | `bg-domain-relationship`, `text-domain-relationship` |
| Strategic | #7CB342 (Green) | `bg-domain-strategic`, `text-domain-strategic` |

Each domain color has variants: `DEFAULT`, `-light`, `-dark`, `-muted` (e.g., `bg-domain-executing-light`).

### Multi-Tenant Architecture
- **Organization**: Contains members, challenges, feed items, review cycles. Has `inviteCode` for member signup.
- **User**: Can belong to multiple organizations via OrganizationMember
- **OrganizationMember**: Junction table with role (OWNER/ADMIN/MEMBER), strengths (1-34 ranking), points, badges
- Session contains: `id`, `email`, `name`, `organizationId`, `memberId`, `role`
- All API routes must verify both `organizationId` and `memberId` from session

### Route Protection
Protected routes (require auth): `/dashboard`, `/team`, `/directory`, `/marketplace`, `/mentorship`, `/shoutouts`, `/challenges`, `/cards`, `/leaderboard`, `/feed`, `/settings`, `/admin`, `/notifications`, `/partnerships`, `/reviews`

Auth routes redirect to dashboard if logged in: `/auth/login`, `/auth/register`

### API Response Pattern
```typescript
import { apiSuccess, apiError, ApiErrorCode, apiCreated, apiListSuccess, apiErrors } from '@/lib/api/response';

// Success
return apiSuccess(data, 'Optional message');

// Created (201)
return apiCreated(newResource);

// List with pagination
return apiListSuccess(data, { page, limit, total, hasMore });

// Error (explicit)
return apiError(ApiErrorCode.NOT_FOUND, 'Resource not found');

// Error (convenience helpers)
return apiErrors.unauthorized();
return apiErrors.notFound('Member');
return apiErrors.badRequest('Invalid input', { field: 'email' });
```

### Prisma JSON Fields
When working with Prisma JSON fields (like `progress`, `rules`, `content`), use this pattern:
```typescript
// Convert to JSON-safe format before saving
await prisma.model.create({
  data: {
    jsonField: JSON.parse(JSON.stringify(objectData)),
  },
});
```

## Code Standards

1. **NO mock data** - Real database connections only
2. **NO placeholders** - Every function fully implemented
3. **NO hardcoded values** - Environment variables only
4. **Complete error handling** - Production-grade try/catch
5. **Full validation** - Input validation with Zod
6. **Security built-in** - Parameterized queries, XSS prevention
7. **Modal dialogs** - Use `@radix-ui/react-alert-dialog` instead of browser alerts
8. **Full-stack completeness** - Every backend feature needs frontend UI

## Common Patterns

### Adding a new page
1. Create `src/app/[route]/page.tsx`
2. Create `src/app/[route]/layout.tsx` with DashboardLayout wrapper
3. Add to navigation in `src/components/layout/DashboardLayout.tsx`

### Adding a new API route
```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(request: NextRequest) {
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

    // ... implementation
    return apiSuccess(data);
  } catch (error) {
    console.error("Error:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to process request");
  }
}
```

### Dynamic Route with Next.js 15
```typescript
// In API routes (server):
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;  // Must await params in Next.js 15
  // ... implementation
}

// In client components, use the `use` hook:
import { use } from "react";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // ...
}
```

### Using theme/domain colors
```tsx
import { ThemeBadge } from "@/components/strengths/ThemeBadge";
import { DomainIcon } from "@/components/strengths/DomainIcon";
import type { DomainSlug } from "@/constants/strengths-data";

// DomainSlug = "executing" | "influencing" | "relationship" | "strategic"
<ThemeBadge themeName="Strategic" domainSlug="strategic" />
<DomainIcon domain={domain as DomainSlug} />
```

### Common Prisma Include Patterns
```typescript
// Fetch member with top strengths (used throughout codebase)
const member = await prisma.organizationMember.findFirst({
  where: { id: memberId },
  include: {
    user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
    strengths: {
      where: { rank: { lte: 5 } },  // Top 5 only
      include: {
        theme: { include: { domain: { select: { slug: true } } } },
      },
      orderBy: { rank: "asc" },
    },
  },
});
```

### Points System
| Action | Points |
|--------|--------|
| Give shoutout | +5 |
| Receive shoutout | +10 |
| Respond to skill request | +15 |
| Response accepted | +25 |
| Complete challenge | +50 |
| Comment on feed | +2 |

## Environment Variables

Required in `.env.local`:
```env
DATABASE_URL=postgresql://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -base64 32>
OPENAI_API_KEY=sk-...  # Required for AI features
```

Optional:
```env
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET
REDIS_URL
RESEND_API_KEY  # For email features
```

## Key Features

### Strengths Bingo Challenge
- 5x5 grid stored as JSON in `ChallengeParticipant.progress`
- Win conditions: row, column, or diagonal

### Mentorship Matching
- Complementary strengths defined in `MENTORSHIP_PAIRINGS` constant
- Score based on theme pairings + domain diversity

### Activity Feed
- Polymorphic `FeedItem` with types: SHOUTOUT, SKILL_REQUEST, BADGE_EARNED, etc.
- Reactions: like, celebrate, love, star, clap
- Threaded comments via `parentId`

### Performance Reviews
- Cycles: QUARTERLY, SEMI_ANNUAL, ANNUAL, PROJECT, PROBATION
- ReviewGoal with `alignedThemes` for strengths-based goals
- ReviewEvidence links to shoutouts, mentorship, challenges

## AI Integration

### Streaming Chat
```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

const result = await streamText({
  model: openai('gpt-4o-mini'),
  messages,
  system: 'You are a CliftonStrengths coach...',
});

return result.toDataStreamResponse();
```

Frontend uses `useChat` hook from `@ai-sdk/react` for streaming responses.

### AI Features
Located in `src/app/api/ai/`:
- `enhance-shoutout` - Improve shoutout messages
- `generate-bio` - Create strength-based bios
- `recognition-starters` / `recognition-prompts` - Suggest recognition text
- `team-narrative` - Generate team strength stories
- `gap-recommendations` - Suggest how to address team gaps
- `development-insights` - Personal development suggestions
- `partnership-reasoning` - Explain why two people work well together
- `mentorship-guide` - Mentorship conversation guides
- `match-skill-request` - Find team members for skill requests
- `goals/suggest` - Suggest performance review goals
- `chat` - General strengths coaching chat

AI usage is tracked in `AIUsageLog` table with token counts and costs.

## Key Data Relationships

### Strengths Flow
1. Admin uploads PDF → `StrengthsDocument` created
2. PDF parsed → 34 `MemberStrength` records created (rank 1-34)
3. `isTop5` and `isTop10` flags set automatically
4. Each `MemberStrength` links to `StrengthTheme` → `StrengthDomain`

### Gamification Flow
1. Actions (shoutouts, challenges, etc.) trigger point awards
2. Points accumulate on `OrganizationMember.points`
3. Badge criteria checked → `BadgeEarned` records created
4. `FeedItem` created for social visibility
5. `Notification` sent to relevant users
