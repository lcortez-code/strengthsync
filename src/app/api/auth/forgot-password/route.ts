import { readAuthJson, protectAuthRequest, authProtectionResponse, AuthProtectionError } from "@/lib/auth/request-protection";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { sendPasswordReset, ResetEmailCooldownError } from "@/lib/auth/account-emails";
import { z } from "zod";

const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(254) });

export async function POST(request: NextRequest) {
  try {
    const validation = forgotPasswordSchema.safeParse(await readAuthJson(request));
    if (!validation.success) return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid email address");
    await protectAuthRequest("forgot-password", request.headers, validation.data.email);
    const user = await prisma.user.findUnique({
      where: { email: validation.data.email.toLowerCase() },
      select: { id: true, email: true, fullName: true },
    });
    if (user) {
      try {
        await sendPasswordReset(user);
      } catch (error) {
        if (error instanceof AuthProtectionError && error.status === 503) throw error;
        // Keep the same response for unknown accounts and delivery failures.
        if (!(error instanceof ResetEmailCooldownError)) console.error("Password reset email could not be delivered");
      }
    }
    return apiSuccess({ message: "If an account exists with that email, you will receive a password reset link." });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    return apiError(ApiErrorCode.BAD_REQUEST, "Unable to process request");
  }
}
