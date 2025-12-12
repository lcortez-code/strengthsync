import { prisma } from "@/lib/prisma";

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

// In-memory rate limiting store (for quick checks)
// In production, consider using Redis for distributed rate limiting
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Get rate limit key
function getRateLimitKey(
  type: "user" | "organization",
  id: string,
  window: "minute" | "hour" | "day"
): string {
  return `ratelimit:${type}:${id}:${window}`;
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

// Check and update in-memory rate limit
function checkMemoryLimit(
  key: string,
  limit: number,
  windowMs: number
): { count: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    // Window expired or doesn't exist, create new
    const data = { count: 1, resetAt: now + windowMs };
    rateLimitStore.set(key, data);
    return data;
  }

  // Increment existing counter
  existing.count += 1;
  rateLimitStore.set(key, existing);
  return existing;
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Clean every minute

// Check rate limit for a user
export async function checkUserRateLimit(
  memberId: string,
  organizationId: string
): Promise<RateLimitResult> {
  // Check per-minute limit
  const minuteKey = getRateLimitKey("user", memberId, "minute");
  const minuteData = checkMemoryLimit(
    minuteKey,
    RATE_LIMITS.user.requestsPerMinute,
    getWindowDuration("minute")
  );

  if (minuteData.count > RATE_LIMITS.user.requestsPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(minuteData.resetAt),
      reason: "Rate limit exceeded: too many requests per minute",
    };
  }

  // Check per-hour limit
  const hourKey = getRateLimitKey("user", memberId, "hour");
  const hourData = checkMemoryLimit(
    hourKey,
    RATE_LIMITS.user.requestsPerHour,
    getWindowDuration("hour")
  );

  if (hourData.count > RATE_LIMITS.user.requestsPerHour) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(hourData.resetAt),
      reason: "Rate limit exceeded: too many requests per hour",
    };
  }

  // Check per-day limit
  const dayKey = getRateLimitKey("user", memberId, "day");
  const dayData = checkMemoryLimit(
    dayKey,
    RATE_LIMITS.user.requestsPerDay,
    getWindowDuration("day")
  );

  if (dayData.count > RATE_LIMITS.user.requestsPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(dayData.resetAt),
      reason: "Rate limit exceeded: daily limit reached",
    };
  }

  // Check organization limits
  const orgResult = await checkOrganizationRateLimit(organizationId);
  if (!orgResult.allowed) {
    return orgResult;
  }

  return {
    allowed: true,
    remaining: Math.min(
      RATE_LIMITS.user.requestsPerMinute - minuteData.count,
      RATE_LIMITS.user.requestsPerHour - hourData.count,
      RATE_LIMITS.user.requestsPerDay - dayData.count
    ),
    resetAt: new Date(minuteData.resetAt),
  };
}

// Check rate limit for an organization
export async function checkOrganizationRateLimit(
  organizationId: string
): Promise<RateLimitResult> {
  // Check per-minute limit
  const minuteKey = getRateLimitKey("organization", organizationId, "minute");
  const minuteData = checkMemoryLimit(
    minuteKey,
    RATE_LIMITS.organization.requestsPerMinute,
    getWindowDuration("minute")
  );

  if (minuteData.count > RATE_LIMITS.organization.requestsPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(minuteData.resetAt),
      reason: "Organization rate limit exceeded: too many requests per minute",
    };
  }

  // Check per-hour limit
  const hourKey = getRateLimitKey("organization", organizationId, "hour");
  const hourData = checkMemoryLimit(
    hourKey,
    RATE_LIMITS.organization.requestsPerHour,
    getWindowDuration("hour")
  );

  if (hourData.count > RATE_LIMITS.organization.requestsPerHour) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(hourData.resetAt),
      reason: "Organization rate limit exceeded: too many requests per hour",
    };
  }

  // Check per-day limit
  const dayKey = getRateLimitKey("organization", organizationId, "day");
  const dayData = checkMemoryLimit(
    dayKey,
    RATE_LIMITS.organization.requestsPerDay,
    getWindowDuration("day")
  );

  if (dayData.count > RATE_LIMITS.organization.requestsPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(dayData.resetAt),
      reason: "Organization rate limit exceeded: daily limit reached",
    };
  }

  return {
    allowed: true,
    remaining: Math.min(
      RATE_LIMITS.organization.requestsPerMinute - minuteData.count,
      RATE_LIMITS.organization.requestsPerHour - hourData.count,
      RATE_LIMITS.organization.requestsPerDay - dayData.count
    ),
    resetAt: new Date(minuteData.resetAt),
  };
}

// Check token usage for the day (from database)
export async function checkTokenLimit(
  memberId: string,
  organizationId: string
): Promise<RateLimitResult> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Get today's token usage from AIUsageLog
  const [userUsage, orgUsage] = await Promise.all([
    prisma.aIUsageLog.aggregate({
      where: {
        memberId,
        createdAt: { gte: startOfDay },
        success: true,
      },
      _sum: {
        totalTokens: true,
      },
    }),
    prisma.aIUsageLog.aggregate({
      where: {
        organizationId,
        createdAt: { gte: startOfDay },
        success: true,
      },
      _sum: {
        totalTokens: true,
      },
    }),
  ]);

  const userTokensUsed = userUsage._sum.totalTokens || 0;
  const orgTokensUsed = orgUsage._sum.totalTokens || 0;

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  if (userTokensUsed >= RATE_LIMITS.tokens.perUserPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: endOfDay,
      reason: "Daily token limit reached for user",
    };
  }

  if (orgTokensUsed >= RATE_LIMITS.tokens.perOrgPerDay) {
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
