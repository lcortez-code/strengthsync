import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiError, ApiErrorCode } from "@/lib/api/response";

// POST - Create new conversation
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const body = await request.json();
    const { title } = body;

    const conversation = await prisma.aIConversation.create({
      data: {
        memberId,
        organizationId,
        title: title || "New conversation",
        status: "ACTIVE",
        context: {},
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return apiCreated(conversation);
  } catch (error) {
    console.error("[Create Conversation Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create conversation");
  }
}

// GET - List conversations for current user
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const conversations = await prisma.aIConversation.findMany({
      where: {
        memberId,
        organizationId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 50,
    });

    return apiSuccess(conversations);
  } catch (error) {
    console.error("[List Conversations Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to list conversations");
  }
}
