import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

// GET - Get a specific conversation with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    if (!memberId || !session.user.organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { conversationId } = await params;

    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        memberId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!conversation) {
      return apiError(ApiErrorCode.NOT_FOUND, "Conversation not found");
    }

    return apiSuccess(conversation);
  } catch (error) {
    console.error("[Get Conversation Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to get conversation");
  }
}

// PATCH - Rename conversation
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    if (!memberId || !session.user.organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { conversationId } = await params;
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== "string" || !title.trim() || title.length > 200) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Title is required");
    }

    // Verify ownership
    const existing = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        memberId,
        status: "ACTIVE",
      },
    });

    if (!existing) {
      return apiError(ApiErrorCode.NOT_FOUND, "Conversation not found");
    }

    const conversation = await prisma.aIConversation.update({
      where: { id: conversationId },
      data: { title: title.trim() },
      select: {
        id: true,
        title: true,
        updatedAt: true,
      },
    });

    return apiSuccess(conversation);
  } catch (error) {
    console.error("[Rename Conversation Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to rename conversation");
  }
}

// DELETE - Erase owned conversation content and retain an empty tombstone
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    if (!memberId || !session.user.organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { conversationId } = await params;

    const removed = await prisma.$transaction(async (tx) => {
      // Lock the same row used by streaming persistence before removing messages.
      const result = await tx.aIConversation.updateMany({
        where: { id: conversationId, memberId, organizationId: session.user.organizationId, status: "ACTIVE" },
        data: { status: "DELETED", title: "Deleted conversation" },
      });
      if (result.count !== 1) return false;
      await tx.aIMessage.deleteMany({ where: { conversationId } });
      return true;
    });
    if (!removed) return apiError(ApiErrorCode.NOT_FOUND, "Conversation not found");

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("[Delete Conversation Error]");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete conversation");
  }
}
