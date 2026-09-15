import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type UsageReader = Pick<Prisma.TransactionClient, "aIUsageLog">;

// Rate limit configuration
export const RATE_LIMITS = {
  // Per-user limits
  user: {
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 500,
  },
  // Per-organization limits
  organization: {
    requestsPerMinute: 50,
    requestsPerHour: 500,
    requestsPerDay: 5000,
  },
  // Token limits (to control costs)
  tokens: {
    perUserPerDay: 100000, // ~100k tokens per user per day
    perOrgPerDay: 1000000, // ~1M tokens per org per day
  },
} as const;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: string;
}

export interface AIAdmissionOptions {
  memberId: string;
  organizationId: string;
  feature: string;
  endpoint: string;
  model: string;
  reservedTokens: number;
}

export interface AIAdmissionResult extends RateLimitResult {
  reservationId?: string;
}

// Text tokenizers cannot use more tokens than the input's UTF-8 bytes. Include
// serialized schema/message framing and a generous allowance for provider framing.
export function estimateTokenAllowance(input: unknown, maxOutputTokens: number): number {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4000) {
    throw new Error("AI output limit must be between 1 and 4000 tokens");
  }
  return Buffer.byteLength(JSON.stringify(input), "utf8") + 1024 + maxOutputTokens;
}

// Admission and its durable reservation commit together before any provider call.
// The organization lock serializes both its member and organization budget checks.
export async function reserveAIRequest(options: AIAdmissionOptions): Promise<AIAdmissionResult> {
  const resetAt = new Date(Date.now() + 60_000);
  if (!options.memberId || !options.organizationId || !Number.isSafeInteger(options.reservedTokens) || options.reservedTokens < 1) {
    return { allowed: false, remaining: 0, resetAt, reason: "Invalid AI request allowance" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-admission:${options.organizationId}`}, 0))`;
      const requests = await checkUserRateLimit(options.memberId, options.organizationId, tx);
      if (!requests.allowed) return requests;
      const tokens = await checkTokenLimit(options.memberId, options.organizationId, options.reservedTokens, tx);
      if (!tokens.allowed) return tokens;

      const reservation = await tx.aIUsageLog.create({
        data: {
          memberId: options.memberId,
          organizationId: options.organizationId,
          feature: options.feature,
          endpoint: options.endpoint,
          model: options.model,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          reservedTokens: options.reservedTokens,
          latencyMs: 0,
          success: false,
        },
        select: { id: true },
      });
      return { allowed: true, reservationId: reservation.id, remaining: requests.remaining - 1, resetAt: requests.resetAt };
    }, { maxWait: 10000, timeout: 15000 });
  } catch {
    return { allowed: false, remaining: 0, resetAt, reason: "AI usage admission is temporarily unavailable" };
  }
}

// Get window duration in milliseconds
function getWindowDuration(window: "minute" | "hour" | "day"): number {
  switch (window) {
    case "minute":
      return 60 * 1000;
    case "hour":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
  }
}

// Count admitted requests, including unfinished and failed calls. The admission
// transaction supplies its own client while holding the organization lock.
export async function checkUserRateLimit(
  memberId: string,
  organizationId: string,
  db: UsageReader = prisma
): Promise<RateLimitResult> {
  const now = Date.now();
  const minuteMs = getWindowDuration("minute");
  const hourMs = getWindowDuration("hour");
  const dayMs = getWindowDuration("day");

  const [minuteCount, hourCount, dayCount] = await Promise.all([
    db.aIUsageLog.count({
      where: { memberId, createdAt: { gte: new Date(now - minuteMs) } },
    }),
    db.aIUsageLog.count({
      where: { memberId, createdAt: { gte: new Date(now - hourMs) } },
    }),
    db.aIUsageLog.count({
      where: { memberId, createdAt: { gte: new Date(now - dayMs) } },
    }),
  ]);

  if (minuteCount >= RATE_LIMITS.user.requestsPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now + minuteMs),
      reason: "Rate limit exceeded: too many requests per minute",
    };
  }

  if (hourCount >= RATE_LIMITS.user.requestsPerHour) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now + hourMs),
      reason: "Rate limit exceeded: too many requests per hour",
    };
  }

  if (dayCount >= RATE_LIMITS.user.requestsPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now + dayMs),
      reason: "Rate limit exceeded: daily limit reached",
    };
  }

  // Check organization limits
  const orgResult = await checkOrganizationRateLimit(organizationId, db);
  if (!orgResult.allowed) {
    return orgResult;
  }

  return {
    allowed: true,
    remaining: Math.min(
      RATE_LIMITS.user.requestsPerMinute - minuteCount,
      RATE_LIMITS.user.requestsPerHour - hourCount,
      RATE_LIMITS.user.requestsPerDay - dayCount
    ),
    resetAt: new Date(now + minuteMs),
  };
}

// Check rate limit for an organization. Same AIUsageLog-backed approach as
// checkUserRateLimit above.
export async function checkOrganizationRateLimit(
  organizationId: string,
  db: UsageReader = prisma
): Promise<RateLimitResult> {
  const now = Date.now();
  const minuteMs = getWindowDuration("minute");
  const hourMs = getWindowDuration("hour");
  const dayMs = getWindowDuration("day");

  const [minuteCount, hourCount, dayCount] = await Promise.all([
    db.aIUsageLog.count({
      where: { organizationId, createdAt: { gte: new Date(now - minuteMs) } },
    }),
    db.aIUsageLog.count({
      where: { organizationId, createdAt: { gte: new Date(now - hourMs) } },
    }),
    db.aIUsageLog.count({
      where: { organizationId, createdAt: { gte: new Date(now - dayMs) } },
    }),
  ]);

  if (minuteCount >= RATE_LIMITS.organization.requestsPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now + minuteMs),
      reason: "Organization rate limit exceeded: too many requests per minute",
    };
  }

  if (hourCount >= RATE_LIMITS.organization.requestsPerHour) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now + hourMs),
      reason: "Organization rate limit exceeded: too many requests per hour",
    };
  }

  if (dayCount >= RATE_LIMITS.organization.requestsPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now + dayMs),
      reason: "Organization rate limit exceeded: daily limit reached",
    };
  }

  return {
    allowed: true,
    remaining: Math.min(
      RATE_LIMITS.organization.requestsPerMinute - minuteCount,
      RATE_LIMITS.organization.requestsPerHour - hourCount,
      RATE_LIMITS.organization.requestsPerDay - dayCount
    ),
    resetAt: new Date(now + minuteMs),
  };
}

// Count actual usage plus outstanding allowances over the last 24 hours.
export async function checkTokenLimit(
  memberId: string,
  organizationId: string,
  additionalTokens = 0,
  db: UsageReader = prisma
): Promise<RateLimitResult> {
  const startOfDay = new Date(Date.now() - getWindowDuration("day"));

  // Legacy rows have zero reservedTokens and retain their recorded usage.
  const [userUsage, orgUsage] = await Promise.all([
    db.aIUsageLog.aggregate({
      where: {
        memberId,
        createdAt: { gte: startOfDay },
      },
      _sum: {
        totalTokens: true,
        reservedTokens: true,
      },
    }),
    db.aIUsageLog.aggregate({
      where: {
        organizationId,
        createdAt: { gte: startOfDay },
      },
      _sum: {
        totalTokens: true,
        reservedTokens: true,
      },
    }),
  ]);

  const userTokensUsed = (userUsage._sum.totalTokens || 0) + (userUsage._sum.reservedTokens || 0);
  const orgTokensUsed = (orgUsage._sum.totalTokens || 0) + (orgUsage._sum.reservedTokens || 0);

  const endOfDay = new Date(Date.now() + getWindowDuration("day"));

  if (userTokensUsed + additionalTokens > RATE_LIMITS.tokens.perUserPerDay || userTokensUsed >= RATE_LIMITS.tokens.perUserPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: endOfDay,
      reason: "Daily token limit reached for user",
    };
  }

  if (orgTokensUsed + additionalTokens > RATE_LIMITS.tokens.perOrgPerDay || orgTokensUsed >= RATE_LIMITS.tokens.perOrgPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: endOfDay,
      reason: "Daily token limit reached for organization",
    };
  }

  return {
    allowed: true,
    remaining: Math.min(
      RATE_LIMITS.tokens.perUserPerDay - userTokensUsed,
      RATE_LIMITS.tokens.perOrgPerDay - orgTokensUsed
    ),
    resetAt: endOfDay,
  };
}

// Combined rate limit check
export async function checkAllLimits(
  memberId: string,
  organizationId: string
): Promise<RateLimitResult> {
  // Check request rate limits
  const rateLimitResult = await checkUserRateLimit(memberId, organizationId);
  if (!rateLimitResult.allowed) {
    return rateLimitResult;
  }

  // Check token limits
  const tokenLimitResult = await checkTokenLimit(memberId, organizationId);
  if (!tokenLimitResult.allowed) {
    return tokenLimitResult;
  }

  return {
    allowed: true,
    remaining: Math.min(rateLimitResult.remaining, tokenLimitResult.remaining),
    resetAt: rateLimitResult.resetAt,
  };
}

// Get current usage statistics
export async function getUsageStats(
  memberId: string,
  organizationId: string
): Promise<{
  user: { requests: number; tokens: number };
  organization: { requests: number; tokens: number };
  limits: typeof RATE_LIMITS;
}> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [userStats, orgStats] = await Promise.all([
    prisma.aIUsageLog.aggregate({
      where: {
        memberId,
        createdAt: { gte: startOfDay },
      },
      _count: { id: true },
      _sum: { totalTokens: true },
    }),
    prisma.aIUsageLog.aggregate({
      where: {
        organizationId,
        createdAt: { gte: startOfDay },
      },
      _count: { id: true },
      _sum: { totalTokens: true },
    }),
  ]);

  return {
    user: {
      requests: userStats._count.id,
      tokens: userStats._sum.totalTokens || 0,
    },
    organization: {
      requests: orgStats._count.id,
      tokens: orgStats._sum.totalTokens || 0,
    },
    limits: RATE_LIMITS,
  };
}
