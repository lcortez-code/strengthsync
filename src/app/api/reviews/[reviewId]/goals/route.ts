import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiError, ApiErrorCode } from "@/lib/api/response";
import { generateStructured, checkAIReady } from "@/lib/ai";
import { buildUserContext } from "@/lib/ai/context/user-context";
import { z } from "zod";

// Goal suggestions based on CliftonStrengths themes
const STRENGTHS_GOAL_SUGGESTIONS: Record<string, { title: string; description: string; category: string }[]> = {
  Achiever: [
    { title: "Complete high-impact project ahead of deadline", description: "Leverage your drive for accomplishment to deliver exceptional results", category: "PERFORMANCE" },
    { title: "Mentor a colleague on productivity techniques", description: "Share your work ethic and help others achieve more", category: "COLLABORATION" },
  ],
  Activator: [
    { title: "Champion a new initiative from idea to launch", description: "Use your ability to turn ideas into action", category: "LEADERSHIP" },
    { title: "Reduce decision-making time in team meetings", description: "Help the team move from discussion to action faster", category: "PERFORMANCE" },
  ],
  Analytical: [
    { title: "Develop data-driven insights for a key business decision", description: "Apply your analytical rigor to improve outcomes", category: "PERFORMANCE" },
    { title: "Create a framework for evaluating project proposals", description: "Help the team make better decisions with structured analysis", category: "COLLABORATION" },
  ],
  Strategic: [
    { title: "Identify alternative approaches for a complex challenge", description: "Use your pattern recognition to find the best path forward", category: "PERFORMANCE" },
    { title: "Facilitate a strategic planning session", description: "Help the team see possibilities and chart a course", category: "LEADERSHIP" },
  ],
  Communication: [
    { title: "Present complex information to stakeholders effectively", description: "Leverage your ability to bring ideas to life with words", category: "PERFORMANCE" },
    { title: "Improve team communication processes", description: "Help ensure messages are clear and compelling", category: "COLLABORATION" },
  ],
  Developer: [
    { title: "Help a team member grow in their role", description: "Invest in someone's potential and track their progress", category: "COLLABORATION" },
    { title: "Create a learning path for new team members", description: "Use your insight into growth to accelerate onboarding", category: "LEADERSHIP" },
  ],
  Empathy: [
    { title: "Improve team morale during challenging times", description: "Use your ability to sense emotions to support others", category: "COLLABORATION" },
    { title: "Gather meaningful feedback on team dynamics", description: "Leverage your ability to understand perspectives", category: "LEADERSHIP" },
  ],
  Includer: [
    { title: "Ensure all voices are heard in team discussions", description: "Use your awareness of who's left out to build belonging", category: "COLLABORATION" },
    { title: "Onboard new team members with warmth", description: "Help newcomers feel welcome and integrated", category: "COLLABORATION" },
  ],
  Learner: [
    { title: "Master a new skill relevant to your role", description: "Channel your love of learning into professional growth", category: "DEVELOPMENT" },
    { title: "Share learnings with the team monthly", description: "Turn your learning into team knowledge", category: "COLLABORATION" },
  ],
  Responsibility: [
    { title: "Take ownership of a critical team deliverable", description: "Leverage your commitment to follow through", category: "PERFORMANCE" },
    { title: "Establish accountability practices for the team", description: "Help create a culture of ownership", category: "LEADERSHIP" },
  ],
  Restorative: [
    { title: "Resolve a persistent team or process issue", description: "Apply your problem-solving ability to fix what's broken", category: "PERFORMANCE" },
    { title: "Develop a troubleshooting guide for common problems", description: "Share your restoration expertise", category: "COLLABORATION" },
  ],
  Focus: [
    { title: "Deliver a complex project requiring sustained attention", description: "Use your ability to concentrate on what matters", category: "PERFORMANCE" },
    { title: "Help team prioritize and reduce distractions", description: "Share your clarity about what's important", category: "LEADERSHIP" },
  ],
  Futuristic: [
    { title: "Develop a vision document for your team's future", description: "Inspire others with what could be", category: "LEADERSHIP" },
    { title: "Identify emerging trends affecting your work", description: "Use your foresight to prepare the team", category: "PERFORMANCE" },
  ],
  Ideation: [
    { title: "Generate innovative solutions for a business challenge", description: "Apply your creativity to real problems", category: "PERFORMANCE" },
    { title: "Lead brainstorming sessions for the team", description: "Help others unlock their creative potential", category: "LEADERSHIP" },
  ],
  Relator: [
    { title: "Deepen working relationships with key stakeholders", description: "Build the trust that enables great collaboration", category: "COLLABORATION" },
    { title: "Create a buddy system for new team members", description: "Use your relational gifts to help others connect", category: "COLLABORATION" },
  ],
  Woo: [
    { title: "Expand your professional network strategically", description: "Leverage your ability to win others over", category: "DEVELOPMENT" },
    { title: "Represent the team at cross-functional events", description: "Be the team's ambassador and connector", category: "COLLABORATION" },
  ],
  Command: [
    { title: "Lead a difficult conversation to resolution", description: "Use your presence to address tough issues", category: "LEADERSHIP" },
    { title: "Step up during a crisis situation", description: "Provide the decisiveness the team needs", category: "LEADERSHIP" },
  ],
  Harmony: [
    { title: "Reduce team conflict and find common ground", description: "Use your ability to find agreement", category: "COLLABORATION" },
    { title: "Streamline a process with competing stakeholders", description: "Build consensus around shared goals", category: "PERFORMANCE" },
  ],
  Positivity: [
    { title: "Boost team morale through challenging projects", description: "Bring your enthusiasm to lift others", category: "COLLABORATION" },
    { title: "Celebrate team wins and recognize contributions", description: "Help others see the good in their work", category: "LEADERSHIP" },
  ],
  Maximizer: [
    { title: "Transform a good process into an excellent one", description: "Apply your drive for excellence", category: "PERFORMANCE" },
    { title: "Coach high performers to reach their potential", description: "Help strong contributors become even better", category: "COLLABORATION" },
  ],
};

// Schema for AI-generated goal suggestions
const aiGoalSuggestionSchema = z.object({
  goals: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum(["PERFORMANCE", "DEVELOPMENT", "STRENGTHS_APPLICATION", "COLLABORATION", "LEADERSHIP"]),
      alignedThemes: z.array(z.string()),
      actionItems: z.array(z.string()),
    })
  ),
});

/**
 * Generate AI-powered goal suggestions for a review
 */
async function generateAIGoalSuggestions(
  memberId: string,
  organizationId: string,
  cycleName: string,
  cycleType: string
): Promise<Array<{
  title: string;
  description: string;
  category: string;
  alignedThemes: string[];
  actionItems: string[];
  isAIGenerated: boolean;
}> | null> {
  const aiReady = checkAIReady();
  if (!aiReady.ready) {
    return null;
  }

  const userContext = await buildUserContext(memberId);
  if (!userContext || userContext.topStrengths.length === 0) {
    return null;
  }

  const systemPrompt = `You are a strengths-based performance coach. Generate 4-5 personalized development goals for a performance review.

Each goal should:
1. Be SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
2. Leverage the person's CliftonStrengths
3. Be practical and actionable
4. Include specific action items

Focus on leveraging strengths, not fixing weaknesses.`;

  const userPrompt = `Generate personalized goals for ${userContext.fullName}'s ${cycleName} (${cycleType}) performance review.

**Their Top Strengths:**
${userContext.topStrengths.map((s, i) => `${i + 1}. ${s.name} (${s.domain})`).join("\n")}
${userContext.dominantDomain ? `\nDominant Domain: ${userContext.dominantDomain}` : ""}
${userContext.jobTitle ? `\nRole: ${userContext.jobTitle}` : ""}

**Recent Activity:**
- Shoutouts given: ${userContext.recentActivity.shoutoutsGiven}
- Shoutouts received: ${userContext.recentActivity.shoutoutsReceived}
- Skill requests helped: ${userContext.recentActivity.skillRequestsHelped}

Generate 4-5 goals that play to their strengths and help them grow in their role.`;

  try {
    const result = await generateStructured({
      memberId,
      organizationId,
      feature: "goal-suggestions",
      prompt: userPrompt,
      systemPrompt,
      schema: aiGoalSuggestionSchema,
      schemaName: "review_goal_suggestions",
    });

    if (!result.success || !result.data) {
      return null;
    }

    return result.data.goals.map((g) => ({
      ...g,
      isAIGenerated: true,
    }));
  } catch (error) {
    console.error("[AI Goal Suggestions] Error:", error);
    return null;
  }
}

/**
 * GET /api/reviews/[reviewId]/goals
 * Get goals for a review, including AI suggestions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  try {
    const { reviewId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const useAI = searchParams.get("ai") === "true";

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: { organizationId },
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
      include: {
        cycle: {
          select: {
            name: true,
            cycleType: true,
          },
        },
        goals: {
          orderBy: { createdAt: "asc" },
        },
        member: {
          include: {
            strengths: {
              where: { rank: { lte: 5 } },
              include: {
                theme: { select: { name: true } },
              },
              orderBy: { rank: "asc" },
            },
          },
        },
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found");
    }

    const topThemes = review.member.strengths.map((s) => s.theme.name);

    // Generate AI suggestions if requested
    let aiSuggestions: Array<{
      title: string;
      description: string;
      category: string;
      alignedThemes: string[];
      actionItems: string[];
      isAIGenerated: boolean;
    }> | null = null;

    if (useAI) {
      aiSuggestions = await generateAIGoalSuggestions(
        review.memberId,
        organizationId,
        review.cycle.name,
        review.cycle.cycleType
      );
    }

    // Generate static suggestions based on top strengths (fallback)
    const staticSuggestions: Array<{
      title: string;
      description: string;
      category: string;
      alignedTheme: string;
    }> = [];

    for (const themeName of topThemes) {
      const themeSuggestions = STRENGTHS_GOAL_SUGGESTIONS[themeName];
      if (themeSuggestions) {
        for (const suggestion of themeSuggestions) {
          staticSuggestions.push({
            ...suggestion,
            alignedTheme: themeName,
          });
        }
      }
    }

    return apiSuccess({
      goals: review.goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        category: g.category,
        alignedThemes: g.alignedThemes,
        suggestedByAI: g.suggestedByAI,
        status: g.status,
        progress: g.progress,
        selfRating: g.selfRating,
        managerRating: g.managerRating,
        comments: g.comments,
        dueDate: g.dueDate?.toISOString() || null,
        createdAt: g.createdAt.toISOString(),
      })),
      suggestions: aiSuggestions || staticSuggestions.slice(0, 10),
      aiSuggestionsAvailable: aiSuggestions !== null,
      topStrengths: topThemes,
    });
  } catch (error) {
    console.error("[Get Review Goals Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch goals");
  }
}

/**
 * POST /api/reviews/[reviewId]/goals
 * Add a goal to a review
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  try {
    const { reviewId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: {
          organizationId,
          status: "ACTIVE",
        },
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found or cycle not active");
    }

    const body = await request.json();
    const { title, description, category, alignedThemes, dueDate, suggestedByAI } = body;

    if (!title) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Goal title is required");
    }

    const validCategories = ["PERFORMANCE", "DEVELOPMENT", "STRENGTHS_APPLICATION", "COLLABORATION", "LEADERSHIP"];
    if (category && !validCategories.includes(category)) {
      return apiError(ApiErrorCode.BAD_REQUEST, `Invalid category. Must be one of: ${validCategories.join(", ")}`);
    }

    const goal = await prisma.reviewGoal.create({
      data: {
        reviewId,
        title,
        description: description || null,
        category: category || "PERFORMANCE",
        alignedThemes: alignedThemes || [],
        suggestedByAI: suggestedByAI || false,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    return apiCreated({
      id: goal.id,
      title: goal.title,
      description: goal.description,
      category: goal.category,
      alignedThemes: goal.alignedThemes,
      suggestedByAI: goal.suggestedByAI,
      status: goal.status,
      progress: goal.progress,
      dueDate: goal.dueDate?.toISOString() || null,
      createdAt: goal.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("[Create Review Goal Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create goal");
  }
}

/**
 * PATCH /api/reviews/[reviewId]/goals
 * Update a goal (via query param ?goalId=xxx)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  try {
    const { reviewId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const goalId = searchParams.get("goalId");

    if (!goalId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Goal ID required");
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: { organizationId, status: "ACTIVE" },
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found");
    }

    const goal = await prisma.reviewGoal.findFirst({
      where: {
        id: goalId,
        reviewId,
      },
    });

    if (!goal) {
      return apiError(ApiErrorCode.NOT_FOUND, "Goal not found");
    }

    const isSubject = review.memberId === memberId;
    const isReviewer = review.reviewerId === memberId;

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    // Both can update basic fields
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.status !== undefined) {
      const validStatuses = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "DEFERRED"];
      if (validStatuses.includes(body.status)) {
        updateData.status = body.status;
      }
    }
    if (body.progress !== undefined) {
      updateData.progress = Math.max(0, Math.min(100, body.progress));
    }
    if (body.comments !== undefined) updateData.comments = body.comments;

    // Subject can set self-rating
    if (isSubject && body.selfRating !== undefined) {
      const validRatings = ["EXCEEDED", "MET", "PARTIALLY_MET", "NOT_MET"];
      if (validRatings.includes(body.selfRating)) {
        updateData.selfRating = body.selfRating;
      }
    }

    // Reviewer can set manager rating
    if (isReviewer && body.managerRating !== undefined) {
      const validRatings = ["EXCEEDED", "MET", "PARTIALLY_MET", "NOT_MET"];
      if (validRatings.includes(body.managerRating)) {
        updateData.managerRating = body.managerRating;
      }
    }

    const updated = await prisma.reviewGoal.update({
      where: { id: goalId },
      data: updateData,
    });

    return apiSuccess({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      category: updated.category,
      status: updated.status,
      progress: updated.progress,
      selfRating: updated.selfRating,
      managerRating: updated.managerRating,
      comments: updated.comments,
    });
  } catch (error) {
    console.error("[Update Review Goal Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update goal");
  }
}

/**
 * DELETE /api/reviews/[reviewId]/goals
 * Delete a goal (via query param ?goalId=xxx)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  try {
    const { reviewId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const goalId = searchParams.get("goalId");

    if (!goalId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Goal ID required");
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id: reviewId,
        cycle: { organizationId, status: "ACTIVE" },
        OR: [
          { memberId },
          { reviewerId: memberId },
        ],
      },
    });

    if (!review) {
      return apiError(ApiErrorCode.NOT_FOUND, "Review not found");
    }

    await prisma.reviewGoal.deleteMany({
      where: {
        id: goalId,
        reviewId,
      },
    });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("[Delete Review Goal Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete goal");
  }
}
