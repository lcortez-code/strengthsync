const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TeamsIdentity {
  tenantId: string;
  teamsUserId: string;
  conversationId: string;
  displayName: string;
}

export function configuredTeamsTenant(): string | null {
  const tenant = process.env.MICROSOFT_APP_TENANT_ID?.trim();
  return tenant && UUID.test(tenant) ? tenant.toLowerCase() : null;
}

export function isTeamsBotConfigured(): boolean {
  return !!(configuredTeamsTenant() && process.env.MICROSOFT_APP_ID?.trim() && process.env.MICROSOFT_APP_PASSWORD?.trim());
}

// This check belongs inside the adapter-authenticated callback, never before it as a substitute for authentication.
export function identifyTeamsActivity(activity: unknown): TeamsIdentity | null {
  if (!activity || typeof activity !== "object" || !isTeamsBotConfigured()) return null;
  const value = activity as Record<string, any>;
  const tenantId = value.channelData?.tenant?.id;
  const teamsUserId = value.from?.aadObjectId;
  const conversation = value.conversation;
  if (value.channelId !== "msteams" || conversation?.conversationType !== "personal" ||
      typeof tenantId !== "string" || tenantId.toLowerCase() !== configuredTeamsTenant() ||
      typeof teamsUserId !== "string" || !UUID.test(teamsUserId) ||
      typeof conversation.id !== "string" || !conversation.id || conversation.id.length > 512 ||
      (conversation.tenantId != null && (typeof conversation.tenantId !== "string" || conversation.tenantId.toLowerCase() !== tenantId.toLowerCase())) ||
      (value.from?.role != null && value.from.role !== "user")) return null;
  return {
    tenantId: tenantId.toLowerCase(), teamsUserId: teamsUserId.toLowerCase(), conversationId: conversation.id,
    displayName: typeof value.from.name === "string" ? value.from.name.slice(0, 100) : "Your Teams account",
  };
}
