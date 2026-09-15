import type { ReviewGoal } from "@prisma/client";

export function serializeReviewGoal(goal: ReviewGoal, canViewManagerRating: boolean) {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    category: goal.category,
    alignedThemes: goal.alignedThemes,
    suggestedByAI: goal.suggestedByAI,
    status: goal.status,
    progress: goal.progress,
    selfRating: goal.selfRating,
    managerRating: canViewManagerRating ? goal.managerRating : null,
    comments: goal.comments,
    dueDate: goal.dueDate?.toISOString() || null,
    createdAt: goal.createdAt.toISOString(),
  };
}
