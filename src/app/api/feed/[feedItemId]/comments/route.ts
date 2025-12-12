import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiListSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const commentSchema = z.object({
  content: z.string().min(1).max(1000),
  parentId: z.string().optional(),
});

// GET - List all comments for a feed item
export async function GET(
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

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const feedItem = await prisma.feedItem.findFirst({
      where: { id: feedItemId, organizationId },
    });

    if (!feedItem) {
      return apiError(ApiErrorCode.NOT_FOUND, "Feed item not found");
    }

    const comments = await prisma.comment.findMany({
      where: { feedItemId },
      include: {
        author: {
          include: {
            user: { select: { fullName: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const data = comments.map((c) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      author: {
        id: c.authorId,
        name: c.author.user.fullName,
        avatarUrl: c.author.user.avatarUrl,
      },
      createdAt: c.createdAt.toISOString(),
    }));

    return apiSuccess(data);
  } catch (error) {
    console.error("Error fetching comments:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch comments");
  }
}

// POST - Add a comment
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
    const validation = commentSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { content, parentId } = validation.data;

    // Verify parent exists if provided
    if (parentId) {
      const parent = await prisma.comment.findFirst({
        where: { id: parentId, feedItemId },
      });
      if (!parent) {
        return apiError(ApiErrorCode.NOT_FOUND, "Parent comment not found");
      }
    }

    const comment = await prisma.comment.create({
      data: {
        feedItemId,
        authorId: memberId,
        content,
        parentId,
      },
      include: {
        author: {
          include: {
            user: { select: { fullName: true, avatarUrl: true } },
          },
        },
      },
    });

    // Award points for commenting
    await prisma.organizationMember.update({
      where: { id: memberId },
      data: { points: { increment: 2 } },
    });

    return apiCreated({
      id: comment.id,
      content: comment.content,
      parentId: comment.parentId,
      author: {
        id: comment.authorId,
        name: comment.author.user.fullName,
        avatarUrl: comment.author.user.avatarUrl,
      },
      createdAt: comment.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Error creating comment:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create comment");
  }
}

// DELETE - Delete a comment (only author can delete)
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
    const role = session.user.role;

    if (!memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get("commentId");

    if (!commentId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Comment ID required");
    }

    const comment = await prisma.comment.findFirst({
      where: { id: commentId, feedItemId },
    });

    if (!comment) {
      return apiError(ApiErrorCode.NOT_FOUND, "Comment not found");
    }

    // Only author or admin can delete
    if (comment.authorId !== memberId && role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Not authorized to delete this comment");
    }

    await prisma.comment.delete({ where: { id: commentId } });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error deleting comment:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete comment");
  }
}
