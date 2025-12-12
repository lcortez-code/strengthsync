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

    const userId = session.user.id;

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const where: Record<string, unknown> = { userId };
    if (unreadOnly) {
      where.read = false;
    }

    const total = await prisma.notification.count({ where });
    const unreadCount = await prisma.notification.count({
      where: { userId, read: false },
    });

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      read: n.read,
      readAt: n.readAt?.toISOString(),
      metadata: n.metadata,
      createdAt: n.createdAt.toISOString(),
    }));

    return apiSuccess({
      data,
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total,
      },
      meta: { unreadCount },
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch notifications");
  }
}

// Mark all as read
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const userId = session.user.id;

    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to mark notifications as read");
  }
}
