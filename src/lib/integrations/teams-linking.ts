import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { configuredTeamsTenant, isTeamsBotConfigured, type TeamsIdentity } from "@/lib/integrations/teams-identity";

export class TeamsLinkError extends Error {
  constructor(message: string, public status: 400 | 403 | 409 = 400) { super(message); }
}

function tokenHash(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new TeamsLinkError("This Teams link is invalid or expired. Request a new link in Teams.");
  return createHash("sha256").update(token).digest("hex");
}

function linkUrl(token: string): string {
  const url = new URL(process.env.NEXTAUTH_URL || "");
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Teams account URL is not configured");
  url.pathname = "/auth/teams-link";
  url.search = "";
  // Fragments are not sent in HTTP requests or referrer headers.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function assertCurrentTenant(tenantId: string): void {
  if (!isTeamsBotConfigured() || tenantId !== configuredTeamsTenant()) throw new TeamsLinkError("Teams is not available for this account link.", 403);
}

/** Called only for identities supplied by the authenticated Bot Framework callback. */
export async function createTeamsLinkChallenge(identity: TeamsIdentity): Promise<string> {
  assertCurrentTenant(identity.tenantId);
  const token = randomBytes(32).toString("hex");
  const url = linkUrl(token);
  const data = {
    tokenHash: tokenHash(token), teamsTenantId: identity.tenantId, teamsUserId: identity.teamsUserId,
    conversationId: identity.conversationId, displayName: identity.displayName,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), consumedAt: null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"teams-link:" + identity.teamsUserId}))`;
    await tx.teamsLinkChallenge.upsert({
      where: { teamsTenantId_teamsUserId: { teamsTenantId: identity.tenantId, teamsUserId: identity.teamsUserId } },
      create: data, update: data,
    });
  });
  return url;
}

export async function reviewTeamsLink(token: string, userId: string) {
  const challenge = await prisma.teamsLinkChallenge.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw new TeamsLinkError("This Teams link is invalid or expired. Request a new link in Teams.");
  assertCurrentTenant(challenge.teamsTenantId);
  const mapping = await prisma.teamsUserMapping.findUnique({ where: { teamsUserId: challenge.teamsUserId } });
  if (mapping && mapping.userId !== userId) throw new TeamsLinkError("This Teams account is already linked to another account. Unlink it from that account first.", 409);
  return { displayName: challenge.displayName, expiresAt: challenge.expiresAt };
}

export async function acceptTeamsLink(token: string, userId: string, organizationId: string) {
  const hash = tokenHash(token);
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.teamsLinkChallenge.findUnique({ where: { tokenHash: hash } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw new TeamsLinkError("This Teams link is invalid or expired. Request a new link in Teams.");
    assertCurrentTenant(challenge.teamsTenantId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"teams-link:" + challenge.teamsUserId}))`;
    const member = await tx.organizationMember.findFirst({
      where: { userId, organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!member) throw new TeamsLinkError("Choose an organization where your membership is active.", 403);
    const existing = await tx.teamsUserMapping.findUnique({ where: { teamsUserId: challenge.teamsUserId } });
    if (existing && (existing.userId !== userId || (existing.teamsTenantId && existing.teamsTenantId !== challenge.teamsTenantId))) {
      throw new TeamsLinkError("This Teams account is already linked to another account. Unlink it from that account first.", 409);
    }
    const consumed = await tx.teamsLinkChallenge.updateMany({
      where: { id: challenge.id, tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new TeamsLinkError("This Teams link has already been used or replaced.", 409);
    const data = {
      userId, organizationId, teamsTenantId: challenge.teamsTenantId,
      teamsChannelId: challenge.conversationId, teamsDisplayName: challenge.displayName, verifiedAt: new Date(),
    };
    const mapping = await tx.teamsUserMapping.upsert({
      where: { teamsUserId: challenge.teamsUserId }, create: { ...data, teamsUserId: challenge.teamsUserId }, update: data,
    });
    return { id: mapping.id, organizationId };
  });
}

export async function unlinkTeamsAccount(mappingId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const mapping = await tx.teamsUserMapping.findFirst({ where: { id: mappingId, userId } });
    if (!mapping) throw new TeamsLinkError("This Teams link was not found.", 403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"teams-link:" + mapping.teamsUserId}))`;
    await tx.teamsUserMapping.deleteMany({ where: { id: mappingId, userId } });
    await tx.teamsLinkChallenge.deleteMany({ where: { teamsUserId: mapping.teamsUserId } });
  });
}

export async function getTeamsLinkStatus(userId: string) {
  const [members, mappings] = await Promise.all([
    prisma.organizationMember.findMany({ where: { userId, status: "ACTIVE" }, select: { organizationId: true, organization: { select: { name: true } } } }),
    prisma.teamsUserMapping.findMany({ where: { userId }, select: { id: true, organizationId: true, teamsDisplayName: true, teamsTenantId: true, verifiedAt: true } }),
  ]);
  const organizations = members.map((member) => ({ id: member.organizationId, name: member.organization.name }));
  return {
    configured: isTeamsBotConfigured(), organizations,
    links: mappings.map((mapping) => ({
      id: mapping.id, displayName: mapping.teamsDisplayName || "Teams account", organizationId: mapping.organizationId,
      organizationName: organizations.find((org) => org.id === mapping.organizationId)?.name || "Organization membership is no longer active",
      active: !!mapping.verifiedAt && mapping.teamsTenantId === configuredTeamsTenant() && isTeamsBotConfigured() && organizations.some((org) => org.id === mapping.organizationId),
    })),
  };
}
