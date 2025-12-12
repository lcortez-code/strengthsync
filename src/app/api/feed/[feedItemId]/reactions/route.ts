import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const reactionSchema = z.object({
  emoji: z.enum(["like", "celebrate", "love", "star", "clap"]),
});

// POST - Add a reaction
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ feedItemId: string }> }
) {
  try {
    const { feedItemId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;

    if (!organizationId || !memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const feedItem = await prisma.feedItem.findFirst({
      where: { id: feedItemId, organizationId },
    });

    if (!feedItem) {
      return apiError(ApiErrorCode.NOT_FOUND, "Feed item not found");
    }

    const body = await request.json();
    const validation = reactionSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid emoji");
    }

    const { emoji } = validation.data;

    // Check if already reacted - update or create
    const existing = await prisma.reaction.findUnique({
      where: {
        feedItemId_memberId: {
          feedItemId,
          memberId,
        },
      },
    });

    if (existing) {
      // Update existing reaction
      const updated = await prisma.reaction.update({
        where: { id: existing.id },
        data: { emoji },
      });

      return apiSuccess({
        id: updated.id,
        emoji: updated.emoji,
      });
    }

    // Create new reaction
    const reaction = await prisma.reaction.create({
      data: {
        feedItemId,
        memberId,
        emoji,
      },
    });

    return apiCreated({
      id: reaction.id,
      emoji: reaction.emoji,
    });
  } catch (error) {
    console.error("Error adding reaction:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to add reaction");
  }
}

// DELETE - Remove a reaction
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ feedItemId: string }> }
) {
  try {
    const { feedItemId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;

    if (!memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const reaction = await prisma.reaction.findUnique({
      where: {
        feedItemId_memberId: {
          feedItemId,
          memberId,
        },
      },
    });

    if (!reaction) {
      return apiError(ApiErrorCode.NOT_FOUND, "Reaction not found");
    }

    await prisma.reaction.delete({ where: { id: reaction.id } });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error removing reaction:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to remove reaction");
  }
}
