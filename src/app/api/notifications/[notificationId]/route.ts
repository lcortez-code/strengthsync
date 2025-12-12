import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

// Mark single notification as read
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  try {
    const { notificationId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const userId = session.user.id;

    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      return apiError(ApiErrorCode.NOT_FOUND, "Notification not found");
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });

    return apiSuccess({
      id: updated.id,
      read: updated.read,
      readAt: updated.readAt?.toISOString(),
    });
  } catch (error) {
    console.error("Error updating notification:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update notification");
  }
}

// Delete notification
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  try {
    const { notificationId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const userId = session.user.id;

    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      return apiError(ApiErrorCode.NOT_FOUND, "Notification not found");
    }

    await prisma.notification.delete({ where: { id: notificationId } });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete notification");
  }
}
