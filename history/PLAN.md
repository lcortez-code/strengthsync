# StrengthSync Implementation Plan

This document outlines the strategic roadmap for enhancing StrengthSync based on CliftonStrengths methodology, behavioral psychology, and UI/UX best practices.

## Executive Summary

StrengthSync is evolving from a basic strengths tracking tool into a comprehensive team development platform. This plan addresses gaps in the "Aim" phase of strengths development, enhances recognition quality, and builds team intelligence features.

**Progress: 15 of 16 tasks completed (94%)**

---

## Phase 1: Foundation Fixes ✅

Technical debt and UI standards compliance.

### 1.1 ConfirmDialog Component ✅
**ID:** `strengthsync-nq5` | **Priority:** P1

Replace browser `confirm()` dialogs with modal ConfirmDialog component using Radix UI.

**Files affected:**
- `src/components/ui/ConfirmDialog.tsx` (created)
- `src/app/admin/members/page.tsx`
- `src/app/marketplace/[requestId]/page.tsx`

**Implementation:** Created reusable ConfirmDialog with variants (danger, warning, info, default), loading states, and async confirm support.

---

### 1.2 Join Organization via Invite Code ✅
**ID:** `strengthsync-0t8` | **Priority:** P1

Enable users to join existing organizations using invite codes.

**Files created:**
- `src/app/auth/join/page.tsx` - 3-step flow (enter code → register/login → join)
- `src/app/api/auth/join/route.ts` - Validate codes, create accounts
- `src/app/api/organizations/join/route.ts` - Join for existing users

**Flow:**
1. User enters 8-character invite code
2. System validates code and shows organization info
3. User registers new account or logs in
4. Membership created, feed item posted

---

### 1.3 Surface Theme Details on Profiles ✅
**ID:** `strengthsync-ruu` | **Priority:** P1

Display fullDescription, blindSpots, actionItems, and worksWith for each strength.

**Files modified:**
- `src/app/api/members/[memberId]/route.ts` - Added theme details to response
- `src/app/team/[memberId]/page.tsx` - Expandable strength cards

**Features:**
- Click to expand any strength
- Shows: About This Strength, Blind Spots, Action Ideas, Partners Well With
- Personalized descriptions when available

---

### 1.4 Mobile Responsiveness Audit ✅
**ID:** `strengthsync-urv` | **Priority:** P2

Audit and fix mobile responsiveness issues.

**Changes:**
- Admin members table: Progressive column hiding (status@sm, strengths@md, points/joined@lg)
- Layout already had mobile sidebar support
- Leaderboard already responsive (hides stats on small screens)

---

## Phase 2: Deepen Engagement

Psychology-driven features to increase meaningful usage.

### 2.1 Onboarding Flow ✅
**ID:** `strengthsync-b49` | **Priority:** P2

First-time user education about CliftonStrengths philosophy.

**Files created:**
- `src/components/onboarding/OnboardingModal.tsx`

**5-Step Tour:**
1. Welcome to StrengthSync
2. The Strengths Philosophy (Name-Claim-Aim framework)
3. The Four Domains (Executing, Influencing, Relationship, Strategic)
4. What You Can Do (features overview)
5. Ready to Begin (call to action)

**Trigger:** Shown when `?welcome=true` query param present and not previously completed.

---

### 2.2 Enhanced Shoutout Form ✅
**ID:** `strengthsync-38v` | **Priority:** P2

Make recognition more specific and impactful based on psychology research.

**Enhancements:**
- Quality tips toggle (4 tips for better recognition)
- Starter prompts when message is empty
- "What specific action did they take?" label
- Auto-suggest themes based on 34 keyword mappings
- Optional "Impact" field for describing outcomes

**File:** `src/app/shoutouts/create/page.tsx`

---

### 2.3 My Strengths Deep Dive ✅
**ID:** `strengthsync-tpt` | **Priority:** P2

Dedicated learning section for exploring personal strengths.

**Files created:**
- `src/app/strengths/page.tsx`
- `src/app/strengths/layout.tsx`
- `src/app/api/me/strengths/route.ts`

**Features:**
- Weekly reflection prompts based on dominant domain
- Name-Claim-Aim framework visualization
- Toggle between Top 5 and All 34 themes
- Expand All / Collapse All controls
- Full details: descriptions, blind spots, action items, works with
- Link to find partners with complementary strengths

---

### 2.4 Weekly Email Digest ✅
**ID:** `strengthsync-nii` | **Priority:** P3

Send weekly email summary to users using Resend.

**Files created:**
- `src/lib/email/resend.ts` - Resend email service layer
- `src/lib/email/digest-service.ts` - Data aggregation for digest
- `src/lib/email/templates/weekly-digest.ts` - HTML/text email templates
- `src/app/api/email/digest/route.ts` - Send/preview digest endpoints
- `src/app/api/me/preferences/route.ts` - User preferences API
- `src/app/settings/notifications/page.tsx` - Email preferences UI
- `prisma/schema.prisma` - Added EmailDigestLog model
- `vercel.json` - Cron configuration (Mondays 9 AM UTC)

**Features:**
- Beautiful HTML email with domain colors
- Stats overview: shoutouts given/received, points, streak
- Recognition highlights (up to 5 shoutouts)
- Badge achievements
- Active challenge progress
- Leaderboard position
- Personalized suggested actions
- One-click unsubscribe via email link
- User preferences in Settings > Notifications
- Preview digest before sending
- Cron-compatible endpoint with multiple auth methods

**Environment Variables:**
```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=StrengthSync <noreply@yourdomain.com>
CRON_SECRET=<random-secret-for-cron-jobs>
```

---

## Phase 3: Team Intelligence ✅

Features for understanding and leveraging collective team strengths.

### 3.1 Team Strengths Canvas ✅
**ID:** `strengthsync-u61` | **Priority:** P2

Visual overview of team's collective talent landscape.

**File created:** `src/components/team/TeamCanvas.tsx`

**Features:**
- Domain balance wheel (4 domains with percentages)
- 34-theme coverage grid with color-coded levels (none/low/medium/high)
- Hover tooltips showing which members have each theme
- Insight cards: Blind Spots, Single Coverage, Team Strengths
- Hiring suggestions by domain for missing themes
- Print support

**Integration:** Added as "Team Canvas" tab in `/team` page

---

### 3.2 Project-Based Partnership Recommendations ✅
**ID:** `strengthsync-47h` | **Priority:** P2

Context-aware partner suggestions based on project type.

**File created:** `src/components/team/ProjectPartnerFinder.tsx`

**7 Project Templates:**
1. Building a Presentation
2. Problem Solving
3. Launching New Initiative
4. Team Building
5. Brainstorming Session
6. Writing Documentation
7. Goal Setting & Planning

Each template includes:
- Recommended strengths
- Complementary pairs with reasons
- Auto-matching against team members

**Integration:** Added to Partnerships tab in `/team` page

---

### 3.3 1:1 Partnership Guide Generator ✅
**ID:** `strengthsync-odx` | **Priority:** P2

Personalized collaboration guides for any two team members.

**Files created:**
- `src/app/partnerships/guide/page.tsx`
- `src/app/partnerships/guide/layout.tsx`
- `src/app/api/partnerships/guide/route.ts`

**Guide Contents:**
- Partner profiles with top strengths
- Shared strengths (themes both have)
- Complementary strengths (how they enhance each other)
- Potential friction points (areas needing communication)
- Collaboration tips based on dominant domains
- Print support

**Data:** API includes theme interaction mappings for all 34 themes (complementary and friction patterns).

---

### 3.4 Team Blind Spots Analysis ✅
**ID:** `strengthsync-4ny` | **Priority:** P3

Identify missing themes and provide hiring suggestions.

**Implementation:** Included in TeamCanvas component:
- Blind Spots card (themes not in anyone's top 10)
- Single Coverage card (only one person has these)
- Hiring Suggestions section by domain

---

## Phase 4: Scale & Differentiate

Enterprise features and advanced capabilities.

### 4.1 Manager Dashboard ✅
**ID:** `strengthsync-dyw` | **Priority:** P3

Team health metrics and engagement insights for managers/admins.

**Files created:**
- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/dashboard/layout.tsx`
- `src/app/api/admin/health-metrics/route.ts`

**Metrics Displayed:**
- Team size and strengths upload rate
- Active users with week-over-week trend
- Shoutouts with trend
- Challenge participation rate
- Domain balance distribution
- Top 5 contributors
- Active mentorships
- Contextual alerts (warnings, successes, suggestions)

**Navigation:** Added "Manager Dashboard" to admin nav

---

### 4.2 Strengths-Based 1:1 Meeting Templates ✅
**ID:** `strengthsync-7gf` | **Priority:** P3

Generate personalized meeting agendas based on participants' strengths.

**Files created:**
- `src/app/partnerships/meeting/page.tsx`
- `src/app/partnerships/meeting/layout.tsx`

**Features:**
- 18+ strength-specific questions (Achiever, Activator, Analytical, Communication, Developer, Empathy, Focus, Futuristic, Harmony, Ideation, Includer, Learner, Positivity, Relator, Responsibility, Restorative, Strategic, Woo)
- Structured 30-minute agenda: Opening (5min) → Person 1 (10min) → Person 2 (10min) → Development (5min) → Closing (5min)
- Copy as text functionality
- Print support

---

### 4.3 Performance Review Integration ✅
**ID:** `strengthsync-q5n` | **Priority:** P3

Connect strengths data with performance management through a custom review workflow.

**Database Models Added:**
- `ReviewCycle` - Review periods with configuration options
- `PerformanceReview` - Individual employee reviews
- `ReviewGoal` - Goals with strengths alignment
- `ReviewEvidence` - Evidence collection from shoutouts, skill requests, etc.

**API Endpoints Created:**
```
GET/POST /api/admin/review-cycles - Admin cycle management
GET/PATCH/DELETE /api/admin/review-cycles/[cycleId] - Single cycle operations
GET /api/reviews - User's reviews list
GET/PATCH /api/reviews/[reviewId] - Review details and updates
GET/POST/PATCH/DELETE /api/reviews/[reviewId]/goals - Goal management
GET/POST/DELETE /api/reviews/[reviewId]/evidence - Evidence collection
```

**Frontend Pages Created:**
- `/reviews` - My Reviews page (subject and reviewer views)
- `/reviews/[reviewId]` - Review detail/edit page with:
  - Strengths context display
  - Self-assessment form
  - AI-suggested goals based on top strengths
  - Evidence auto-collection from shoutouts
  - Manager review and rating
- `/admin/review-cycles` - Admin cycle management UI

**Features:**
- Review cycles: Quarterly, Semi-Annual, Annual, Project, Probation
- Self-assessment with strengths highlighting
- AI-powered goal suggestions (20+ strength-specific suggestions)
- Evidence auto-collection: shoutouts received/given, skill requests helped, badges earned, mentorship activities
- Manager review with ratings: Exceeds/Meets/Developing/Needs Improvement
- Goal tracking with progress bars and ratings
- Review status workflow: Not Started → Self-Assessment → Manager Review → Completed → Acknowledged
- Navigation integrated in sidebar for both users and admins

---

### 4.4 Enterprise API ⏳
**ID:** `strengthsync-zal` | **Priority:** P4 | **Status:** Open

REST API for enterprise HR system integrations.

**Planned Features:**
- OAuth2 authentication
- Rate limiting
- Webhooks for events
- Bulk import/export
- SCIM provisioning support
- Connections to Workday, SAP SuccessFactors, etc.

**Complexity:** Significant infrastructure work required.

---

## Technical Notes

### New Routes Added
```
/auth/join                    - Join organization via invite code
/strengths                    - My Strengths Deep Dive
/partnerships/guide           - 1:1 Partnership Guide
/partnerships/meeting         - 1:1 Meeting Template
/admin/dashboard              - Manager Dashboard
/settings/notifications       - Email & notification preferences
/reviews                      - My Performance Reviews
/reviews/[reviewId]           - Review detail/edit
/admin/review-cycles          - Admin review cycle management
```

### New API Endpoints
```
GET  /api/auth/join?code=     - Validate invite code
POST /api/auth/join           - Join with new account
POST /api/organizations/join  - Join for existing users
GET  /api/me/strengths        - Current user's strengths with details
GET  /api/me/preferences      - Get user preferences
PATCH /api/me/preferences     - Update user preferences
GET  /api/partnerships/guide  - Generate partnership guide
GET  /api/admin/health-metrics - Team health metrics
GET  /api/email/digest        - Preview weekly digest (JSON/HTML/text)
POST /api/email/digest        - Send weekly digest (cron/admin)
GET/POST /api/admin/review-cycles - Admin review cycle management
GET/PATCH/DELETE /api/admin/review-cycles/[cycleId] - Single cycle
GET  /api/reviews             - User's reviews list
GET/PATCH /api/reviews/[reviewId] - Review details and updates
GET/POST/PATCH/DELETE /api/reviews/[reviewId]/goals - Goals
GET/POST/DELETE /api/reviews/[reviewId]/evidence - Evidence
```

### New Components
```
src/components/ui/ConfirmDialog.tsx
src/components/onboarding/OnboardingModal.tsx
src/components/team/TeamCanvas.tsx
src/components/team/ProjectPartnerFinder.tsx
```

### Dependencies Added
```
@radix-ui/react-alert-dialog
resend
@react-email/components
```

---

## Remaining Work

| Task | Priority | Status |
|------|----------|--------|
| Enterprise API | P4 | Deferred - Not needed for current scope |

*Note: The Enterprise API (OAuth2, webhooks, SCIM provisioning) is primarily valuable for large organizations with existing HR tech stacks. The current web UI provides full functionality for most teams.*

---

## Tracking

All tasks are tracked in beads:
```bash
bd list          # View all tasks
bd show <id>     # View task details
bd ready         # See what's ready
bd stats         # Progress statistics
```

---

*Last updated: December 12, 2024 - Plan complete (Enterprise API deferred)*
