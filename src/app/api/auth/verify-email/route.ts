import { NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { authProtectionResponse, protectAuthRequest, readAuthJson, passwordSchema } from "@/lib/auth/request-protection";
import { verificationContext, consumeEmailVerification } from "@/lib/auth/email-verification";
const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), invitation: z.string().max(4096).optional() });
const setupSchema = tokenSchema.extend({ password: passwordSchema, acceptInvitation: z.boolean().optional() });

export async function GET(request: NextRequest) {
  try {
    await protectAuthRequest("verify-link", request.headers);
    const params = new URL(request.url).searchParams;
    const validation = tokenSchema.safeParse({ token: params.get("token"), invitation: params.get("invitation") || undefined });
    if (!validation.success) return apiError(ApiErrorCode.BAD_REQUEST, "Invalid verification link");
    const context = await verificationContext(validation.data.token, validation.data.invitation);
    return apiSuccess({ email: context.user.email, organizationName: context.invitation?.organization.name, role: context.invitation?.role });
  } catch (error) { return authProtectionResponse(error) || apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to verify this link"); }
}
export async function POST(request: NextRequest) {
  try {
    await protectAuthRequest("verify-email", request.headers);
    const validation = setupSchema.safeParse(await readAuthJson(request));
    if (!validation.success) return apiError(ApiErrorCode.VALIDATION_ERROR, "Use a valid link and a password of at least 8 characters, within 72 UTF-8 bytes");
    const { token, invitation, password, acceptInvitation } = validation.data;
    await protectAuthRequest("verify-token", request.headers, token);
    if (invitation && acceptInvitation !== true) return apiError(ApiErrorCode.BAD_REQUEST, "Accept the invitation to join this organization");
    // Validate before expensive hashing; consumption rechecks under the transaction.
    await verificationContext(token, invitation);
    await consumeEmailVerification(token, await hash(password, 12), invitation);
    return apiSuccess({ message: "Email verified and password saved. You can now sign in." });
  } catch (error) { return authProtectionResponse(error) || apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to complete verification"); }
}
