import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { authProtectionResponse, protectAuthRequest, readAuthJson, emailSchema, AuthProtectionError } from "@/lib/auth/request-protection";
import { sendEmailVerification, VerificationEmailCooldownError } from "@/lib/auth/account-emails";
const schema = z.object({ email: emailSchema });
export async function POST(request: NextRequest) {
  try {
    await protectAuthRequest("resend-verification", request.headers);
    const parsed = schema.safeParse(await readAuthJson(request));
    if (!parsed.success) return apiError(ApiErrorCode.VALIDATION_ERROR, "Enter a valid email address");
    const email = parsed.data.email.toLowerCase();
    await protectAuthRequest("resend-verification-account", request.headers, email);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, fullName: true, emailVerified: true,
      organizationMemberships: { where: { status: "PENDING" }, include: { organization: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 1 },
    } });
    if (user && !user.emailVerified) {
      const member = user.organizationMemberships[0];
      try { await sendEmailVerification(user, member ? { member, organizationName: member.organization.name } : undefined); }
      catch (error) {
        if (error instanceof AuthProtectionError && error.status === 503) throw error;
        if (!(error instanceof VerificationEmailCooldownError)) console.error("Verification email delivery unavailable");
      }
    }
    return apiSuccess({ message: "If your account needs verification, you will receive an email. Check your inbox and spam folder." });
  } catch (error) { return authProtectionResponse(error) || apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to request verification"); }
}
