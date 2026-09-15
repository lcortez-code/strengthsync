import { readAuthJson, protectAuthRequest, authProtectionResponse, passwordSchema } from "@/lib/auth/request-protection";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { compare, hash } from "bcryptjs";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(1024),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password").max(72),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

/**
 * PATCH /api/settings/password
 *
 * Change password for authenticated user.
 * Requires current password verification.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    await protectAuthRequest("change-password", request.headers, session.user.id);
    const body = await readAuthJson(request);
    const validation = changePasswordSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.errors[0];
      return apiError(ApiErrorCode.VALIDATION_ERROR, firstError.message, {
        errors: validation.error.errors,
      });
    }

    const { currentPassword, newPassword } = validation.data;

    // Fetch user with password hash
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user) {
      return apiError(ApiErrorCode.NOT_FOUND, "User not found");
    }

    // Check if user has a password (might be OAuth-only user)
    if (!user.passwordHash) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "Your account does not have a password set. You may have signed up with a social login."
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Current password is incorrect");
    }

    // Hash new password
    const newPasswordHash = await hash(newPassword, 12);

    // Update password
    const changed = await prisma.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash: newPasswordHash, passwordResetToken: null, passwordResetExpires: null },
    });
    if (changed.count !== 1) return apiError(ApiErrorCode.CONFLICT, "Your password changed during this request. Sign in again.");

    return apiSuccess({
      message: "Password changed successfully",
    });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Password change failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to change password");
  }
}
