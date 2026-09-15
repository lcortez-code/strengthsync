import { authProtectionResponse, protectAuthRequest, readAuthJson } from "@/lib/auth/request-protection";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { sendMemberInvitation, sendPasswordReset, ResetEmailCooldownError, VerificationEmailCooldownError } from "@/lib/auth/account-emails";
import { withManagedMember, requireAnotherActiveOwner, MemberAdministrationError, memberAdministrationError } from "@/lib/auth/member-administration";
import { z } from "zod";

const updateMemberSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).refine((data) => data.role || data.status, "A role or status is required");
type Context = { params: Promise<{ memberId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { memberId } = await params;
    const session = await getServerSession(authOptions);
    const validation = updateMemberSchema.safeParse(await readAuthJson(request));
    if (!validation.success) throw new MemberAdministrationError(ApiErrorCode.VALIDATION_ERROR, "Invalid role or status");
    const updated = await withManagedMember(session, memberId, async (tx, member, actorRole) => {
      if (member.status === "PENDING") throw new MemberAdministrationError(ApiErrorCode.BAD_REQUEST, "The recipient must accept this invitation. Cancel and invite again to change the invited role.");
      const { role, status } = validation.data;
      if (role && role !== "MEMBER" && actorRole !== "OWNER") {
        throw new MemberAdministrationError(ApiErrorCode.FORBIDDEN, "Only owners can assign manager, admin, or owner roles");
      }
      if ((role && role !== "OWNER") || status === "INACTIVE") await requireAnotherActiveOwner(tx, member);
      return tx.organizationMember.update({
        where: { id: member.id }, data: { ...(role && { role }), ...(status && { status }) },
        select: { id: true, role: true, status: true },
      });
    });
    return apiSuccess(updated);
  } catch (error) { return memberAdministrationError(error); }
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { memberId } = await params;
    const session = await getServerSession(authOptions);
    await withManagedMember(session, memberId, async (tx, member) => {
      await requireAnotherActiveOwner(tx, member);
      await tx.organizationMember.delete({ where: { id: member.id } });
    });
    return apiSuccess({ deleted: true });
  } catch (error) { return memberAdministrationError(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { memberId } = await params;
    const session = await getServerSession(authOptions);
    const resend = new URL(request.url).searchParams.get("action") === "resend-invitation";
    const member = await withManagedMember(session, memberId, async (_tx, target) => {
      if (resend ? target.status !== "PENDING" : target.status !== "ACTIVE") {
        throw new MemberAdministrationError(ApiErrorCode.BAD_REQUEST, resend ? "Only pending invitations can be resent" : "Only active members can receive an admin password reset");
      }
      return target;
    });
    await protectAuthRequest("member-email", request.headers, session!.user.id);
    if (resend) {
      await sendMemberInvitation(member);
      return apiSuccess({ invitationSent: true });
    }
    await sendPasswordReset(member.user);
    return apiSuccess({ memberId: member.id, email: member.user.email, name: member.user.fullName, resetLinkSent: true });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    if (error instanceof ResetEmailCooldownError || error instanceof VerificationEmailCooldownError) return apiError(ApiErrorCode.RATE_LIMITED, error.message);
    return memberAdministrationError(error);
  }
}
