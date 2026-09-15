import { readAuthJson, protectAuthRequest, authProtectionResponse, passwordSchema } from "@/lib/auth/request-protection";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";
import { hash } from "bcryptjs";
import { hashResetToken } from "@/lib/auth/account-emails";

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid reset token"),
  password: passwordSchema,
});

// Verify token validity
export async function GET(request: NextRequest) {
  try {
    await protectAuthRequest("reset-link", request.headers);
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Reset token is required");
    }

    // Find user with valid token
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: hashResetToken(token),
        passwordResetExpires: { gt: new Date() },
      },
      select: { id: true, email: true, fullName: true },
    });

    if (!user) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid or expired reset token");
    }

    return apiSuccess({
      valid: true,
      email: user.email,
      name: user.fullName,
    });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Password reset token verification failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to verify token");
  }
}

// Reset password with token
export async function POST(request: NextRequest) {
  try {
    await protectAuthRequest("reset-password", request.headers);
    const body = await readAuthJson(request);
    const validation = resetPasswordSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.errors,
      });
    }

    const { token, password } = validation.data;
    await protectAuthRequest("reset-token", request.headers, token);

    // Find user with valid token
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: hashResetToken(token),
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid or expired reset token");
    }

    // Hash new password
    const passwordHash = await hash(password, 12);

    // Update password and clear reset token
    const consumed = await prisma.user.updateMany({
      where: { id: user.id, passwordResetToken: hashResetToken(token), passwordResetExpires: { gt: new Date() } },
      data: {
        passwordHash,
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    if (consumed.count !== 1) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Invalid or expired reset token");
    }

    return apiSuccess({
      message: "Password reset successful. You can now sign in with your new password.",
    });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    console.error("Password reset failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to reset password");
  }
}
