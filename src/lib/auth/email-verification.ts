import { prisma } from "@/lib/prisma";
import { hashResetToken, readInvitationToken } from "@/lib/auth/account-emails";
import { AuthProtectionError } from "@/lib/auth/request-protection";

export async function verificationContext(token: string, invitationToken?: string) {
  const user = await prisma.user.findFirst({
    where: { emailVerifyToken: hashResetToken(token), emailVerifyExpires: { gt: new Date() }, emailVerified: false },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) throw new AuthProtectionError("This verification link is invalid or expired. Request a new email.", 400);
  const claims = invitationToken ? readInvitationToken(invitationToken) : null;
  if (invitationToken && (!claims || claims.userId !== user.id)) throw new AuthProtectionError("This invitation is invalid or expired.", 400);
  const invitationWhere = claims ? {
    id: claims.memberId, userId: user.id, organizationId: claims.organizationId,
    role: claims.role, status: "PENDING" as const, updatedAt: new Date(claims.version),
  } : null;
  const invitation = invitationWhere ? await prisma.organizationMember.findFirst({
    where: invitationWhere, select: { organization: { select: { name: true } }, role: true },
  }) : null;
  if (claims && !invitation) throw new AuthProtectionError("This invitation has changed or was canceled. Ask for a new invitation.", 400);
  return { user, invitationWhere, invitation, invitationExpiresAt: claims?.expiresAt };
}

export async function consumeEmailVerification(token: string, passwordHash: string, invitationToken?: string) {
  const context = await verificationContext(token, invitationToken);
  await prisma.$transaction(async tx => {
    if (context.invitationExpiresAt && context.invitationExpiresAt <= Date.now()) {
      throw new AuthProtectionError("This invitation expired before acceptance. Request a new invitation.", 400);
    }
    const consumed = await tx.user.updateMany({
      where: { id: context.user.id, emailVerifyToken: hashResetToken(token), emailVerifyExpires: { gt: new Date() }, emailVerified: false },
      data: { emailVerified: true, passwordHash, emailVerifyToken: null, emailVerifyExpires: null,
        passwordResetToken: null, passwordResetExpires: null },
    });
    if (consumed.count !== 1) throw new AuthProtectionError("This verification link is invalid or expired.", 400);
    if (context.invitationWhere) {
      const accepted = await tx.organizationMember.updateMany({ where: context.invitationWhere, data: { status: "ACTIVE", joinedAt: new Date() } });
      if (accepted.count !== 1) throw new AuthProtectionError("This invitation changed before acceptance. Request a new invitation.", 400);
    }
  });
}
