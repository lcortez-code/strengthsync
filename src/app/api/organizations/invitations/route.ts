import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { readInvitationToken } from "@/lib/auth/account-emails";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

async function invitationRequest(request: NextRequest, accept: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return apiError(ApiErrorCode.UNAUTHORIZED, "Sign in to review your invitation");
  const token = new URL(request.url).searchParams.get("token") || "";
  const claims = readInvitationToken(token);
  if (!claims) return apiError(ApiErrorCode.BAD_REQUEST, "This invitation is invalid or expired. Ask the organization to send a new invitation.");
  if (claims.userId !== session.user.id) return apiError(ApiErrorCode.FORBIDDEN, "Sign in with the email address that received this invitation");
  const where = {
    id: claims.memberId, userId: session.user.id, organizationId: claims.organizationId,
    role: claims.role, status: "PENDING" as const, updatedAt: new Date(claims.version),
  };
  const member = await prisma.organizationMember.findFirst({
    where, select: { id: true, role: true, organization: { select: { name: true } } },
  });
  if (!member) return apiError(ApiErrorCode.BAD_REQUEST, "This invitation has already been used, changed, or canceled");
  if (accept) {
    // Keep the consented user, organization, role and invitation version in the write condition.
    if (claims.expiresAt <= Date.now()) return apiError(ApiErrorCode.BAD_REQUEST, "This invitation has expired");
    const result = await prisma.organizationMember.updateMany({
      where, data: { status: "ACTIVE", joinedAt: new Date() },
    });
    if (result.count !== 1) return apiError(ApiErrorCode.CONFLICT, "This invitation has already been used, changed, or canceled");
  }
  return apiSuccess({ organizationId: claims.organizationId, organizationName: member.organization.name, role: member.role, accepted: accept });
}

export async function GET(request: NextRequest) {
  try { return await invitationRequest(request, false); }
  catch { return apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to review invitation"); }
}

export async function POST(request: NextRequest) {
  try { return await invitationRequest(request, true); }
  catch { return apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to accept invitation"); }
}
