import type { Role } from "@/lib/auth/permissions";

export interface AIProfileAccess {
  organizationId: string;
  viewerMemberId: string;
  viewerRole?: Role;
}
