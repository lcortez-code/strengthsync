import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { uploadAvatar, deleteAvatar, validateFile } from "@/lib/storage";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const userId = session.user.id;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("avatar") as File | null;

    if (!file) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No file provided");
    }

    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return apiError(ApiErrorCode.BAD_REQUEST, validation.error.message);
    }

    // Get current user to check for existing avatar
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    // Delete old avatar if it exists and is a local upload
    if (currentUser?.avatarUrl) {
      await deleteAvatar(currentUser.avatarUrl);
    }

    // Upload new avatar
    const result = await uploadAvatar(file, userId);

    // Update user's avatar URL in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: result.url },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
      },
    });

    return apiSuccess({
      avatarUrl: updatedUser.avatarUrl,
      message: "Avatar uploaded successfully",
    });
  } catch (error) {
    console.error("Avatar upload error:", error);
    const message = error instanceof Error ? error.message : "Failed to upload avatar";
    return apiError(ApiErrorCode.INTERNAL_ERROR, message);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const userId = session.user.id;

    // Get current user's avatar
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    // Delete avatar file if it exists
    if (currentUser?.avatarUrl) {
      await deleteAvatar(currentUser.avatarUrl);
    }

    // Clear avatar URL in database
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });

    return apiSuccess({ message: "Avatar removed successfully" });
  } catch (error) {
    console.error("Avatar delete error:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to remove avatar");
  }
}
