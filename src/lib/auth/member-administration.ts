import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, ApiErrorCode } from "@/lib/api/response";

export class MemberAdministrationError extends Error {
  constructor(public code: ApiErrorCode, message: string) { super(message); }
}

/** Serialize membership administration per organization, including active-owner checks. */
export async function withManagedMember<T>(
  session: Session | null,
  memberId: string,
  action: (tx: Prisma.TransactionClient, member: Prisma.OrganizationMemberGetPayload<{
    include: { user: { select: { id: true; email: true; fullName: true; emailVerified: true; emailVerificationRequired: true } }; organization: { select: { name: true } } };
  }>, actorRole: string) => Promise<T>,
): Promise<T> {
  if (!session?.user?.id) throw new MemberAdministrationError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
  const { organizationId, memberId: actorId } = session.user;
  if (!organizationId || !actorId) throw new MemberAdministrationError(ApiErrorCode.FORBIDDEN, "Active organization membership required");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const actor = await tx.organizationMember.findFirst({
      where: { id: actorId, userId: session.user.id, organizationId, status: "ACTIVE" },
    });
    if (!actor || (actor.role !== "OWNER" && actor.role !== "ADMIN")) {
      throw new MemberAdministrationError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }
    const member = await tx.organizationMember.findFirst({
      where: { id: memberId, organizationId },
      include: { user: { select: { id: true, email: true, fullName: true, emailVerified: true, emailVerificationRequired: true } }, organization: { select: { name: true } } },
    });
    if (!member) throw new MemberAdministrationError(ApiErrorCode.NOT_FOUND, "Member not found");
    if (member.id === actor.id) throw new MemberAdministrationError(ApiErrorCode.BAD_REQUEST, "Use your account settings to manage your own account");
    if (actor.role !== "OWNER" && member.role !== "MEMBER") {
      throw new MemberAdministrationError(ApiErrorCode.FORBIDDEN, "Only owners can manage owner, admin, or manager members");
    }
    return action(tx, member, actor.role);
  });
}

export async function requireAnotherActiveOwner(tx: Prisma.TransactionClient, member: { id: string; organizationId: string; role: string; status: string }): Promise<void> {
  if (member.role !== "OWNER" || member.status !== "ACTIVE") return;
  const otherOwners = await tx.organizationMember.count({
    where: { organizationId: member.organizationId, role: "OWNER", status: "ACTIVE", id: { not: member.id } },
  });
  if (!otherOwners) throw new MemberAdministrationError(ApiErrorCode.BAD_REQUEST, "Organization must have at least one active owner");
}

export function memberAdministrationError(error: unknown) {
  if (error instanceof MemberAdministrationError) return apiError(error.code, error.message);
  console.error("Member administration failed");
  return apiError(ApiErrorCode.INTERNAL_ERROR, "Unable to complete member action");
}
