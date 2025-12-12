# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StrengthSync** is a CliftonStrengths-based team collaboration app that helps teams discover, leverage, and celebrate their unique strengths through analytics, recognition, and gamification.

**GitHub Repository**: https://github.com/freeup86/strengthsync

### Key Features
- **Team Analytics**: Domain balance charts, gap analysis, partnership suggestions
- **Skills Directory**: Search and browse team members by strengths and expertise
- **Social Features**: Shoutouts (peer recognition), skill request marketplace, activity feed
- **Gamification**: Points, badges, streaks, leaderboards
- **Challenges**: Team activities like Strengths Bingo
- **Mentorship**: Complementary strength-based matching
- **Strengths Cards**: Digital baseball card-style profile cards
- **Notifications**: Real-time notification system

### Tech Stack
- **Framework**: Next.js 15 (App Router, Turbopack)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js with credentials provider
- **Styling**: Tailwind CSS with custom domain color system
- **UI**: Custom components + Radix UI primitives

## Common Commands

```bash
# Development
npm run dev              # Start dev server (port 3000)
npm run build            # Build for production
npm run lint             # Run ESLint
npm run type-check       # TypeScript type checking

# Database
npm run db:generate      # Generate Prisma client
npm run db:push          # Push schema to database
npm run db:migrate       # Run migrations
npm run db:seed          # Seed domains, themes, badges
npm run db:reset         # Reset database
npx prisma studio        # Open Prisma Studio (DB GUI)
```

## Architecture

### Directory Structure
```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/          # NextAuth endpoints
│   │   ├── challenges/    # Challenges & Bingo
│   │   ├── feed/          # Activity feed, reactions, comments
│   │   ├── mentorship/    # Mentorship matching
│   │   ├── notifications/ # Notifications API
│   │   ├── skill-requests/# Marketplace
│   │   ├── shoutouts/     # Peer recognition
│   │   ├── strengths/     # Strengths upload/parsing
│   │   └── team/          # Team analytics
│   ├── auth/              # Login, register, join pages
│   ├── cards/             # Strengths cards feature
│   ├── challenges/        # Challenges & Bingo
│   ├── dashboard/         # Main dashboard
│   ├── directory/         # Team directory
│   ├── feed/              # Activity feed
│   ├── leaderboard/       # Points leaderboard
│   ├── marketplace/       # Skill requests
│   ├── mentorship/        # Mentorship matching
│   ├── notifications/     # Notifications page
│   ├── shoutouts/         # Peer recognition
│   ├── team/              # Team analytics & profiles
│   └── admin/             # Admin features (upload)
├── components/
│   ├── ui/               # Base UI components (Button, Card, etc.)
│   ├── layout/           # DashboardLayout, Sidebar
│   ├── strengths/        # ThemeBadge, DomainIcon, StrengthsCard
│   ├── team/             # Team analytics components
│   ├── notifications/    # NotificationBell component
│   └── providers/        # SessionProvider
├── lib/
│   ├── prisma.ts         # Prisma client singleton
│   ├── auth/config.ts    # NextAuth configuration
│   ├── api/response.ts   # API response helpers
│   ├── pdf/parser.ts     # CliftonStrengths PDF parser
│   ├── strengths/        # Analytics functions
│   └── utils.ts          # Utility functions
├── constants/
│   └── strengths-data.ts # All 34 themes, 4 domains
├── types/                # TypeScript types
└── middleware.ts         # Auth middleware
```

### CliftonStrengths Domain Colors
| Domain | Hex | Tailwind Classes |
|--------|-----|------------------|
| Executing | #7B68EE (Purple) | `bg-domain-executing`, `text-domain-executing` |
| Influencing | #F5A623 (Orange) | `bg-domain-influencing`, `text-domain-influencing` |
| Relationship | #4A90D9 (Blue) | `bg-domain-relationship`, `text-domain-relationship` |
| Strategic | #7CB342 (Green) | `bg-domain-strategic`, `text-domain-strategic` |

### Database Models (Prisma)
- **StrengthDomain** / **StrengthTheme**: Reference data for 34 themes across 4 domains
- **Organization** / **User** / **OrganizationMember**: Multi-tenant team management
- **MemberStrength**: User's ranked themes (1-34)
- **Shoutout**: Peer recognition tied to themes
- **SkillRequest** / **SkillRequestResponse**: Marketplace for skill needs
- **Mentorship**: Mentor-mentee relationships
- **Badge** / **BadgeEarned**: Gamification achievements
- **TeamChallenge** / **ChallengeParticipant**: Team activities with JSON progress
- **FeedItem** / **Reaction** / **Comment**: Social feed
- **Notification**: User notifications

### API Response Pattern
```typescript
import { apiSuccess, apiError, ApiErrorCode, apiCreated, apiListSuccess } from '@/lib/api/response';

// Success
return apiSuccess(data, 'Optional message');

// Created (201)
return apiCreated(newResource);

// List with pagination
return apiListSuccess(data, { page, limit, total, hasMore });

// Error
return apiError(ApiErrorCode.NOT_FOUND, 'Resource not found');
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

### Authentication
- Uses NextAuth.js with credentials provider
- Session contains: `id`, `email`, `name`, `organizationId`, `memberId`, `role`
- Roles: `OWNER`, `ADMIN`, `MEMBER`
- Protected routes handled via `middleware.ts`

## Code Standards

1. **NO mock data** - Real database connections only
2. **NO placeholders** - Every function fully implemented
3. **NO hardcoded values** - Environment variables only
4. **Complete error handling** - Production-grade try/catch
5. **Full validation** - Input validation with Zod
6. **Security built-in** - Parameterized queries, XSS prevention
7. **Modal dialogs** - Use UI components instead of browser alerts
8. **Full-stack completeness** - Every backend needs frontend UI

## Common Patterns

### Adding a new page
1. Create `src/app/[route]/page.tsx`
2. Create `src/app/[route]/layout.tsx` with DashboardLayout wrapper
3. Add to navigation in `DashboardLayout.tsx`

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
<DomainIcon domain={domain as DomainSlug} withBackground />
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
```

Optional:
```env
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET
REDIS_URL
```

## Feature-Specific Notes

### Strengths Bingo
- 5x5 grid with random themes
- Players mark squares by finding team members with those themes
- Progress stored as JSON in `ChallengeParticipant.progress`
- Win conditions: row, column, or diagonal

### Mentorship Matching
- Based on complementary strengths (defined in `MENTORSHIP_PAIRINGS`)
- Score calculated from theme pairings + domain diversity
- Users can request mentorship from suggested matches

### Activity Feed
- Polymorphic feed items (SHOUTOUT, SKILL_REQUEST, BADGE_EARNED, etc.)
- Reactions: like, celebrate, love, star, clap
- Threaded comments with parentId support

### Notifications
- Real-time polling (30-second intervals)
- Types: SHOUTOUT_RECEIVED, SKILL_REQUEST_RESPONSE, MENTORSHIP_REQUEST, BADGE_EARNED, etc.
- NotificationBell component in header with dropdown
