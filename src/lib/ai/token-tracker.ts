import { prisma } from "@/lib/prisma";
import { calculateCost } from "./client";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
}

export interface UsageLogInput {
  reservationId: string;
  memberId?: string;
  organizationId: string;
  feature: string;
  endpoint: string;
  usage: TokenUsage;
  usageKnown: boolean;
  requestSummary?: string;
  responseSummary?: string;
  success?: boolean;
  errorMessage?: string;
}

// Log AI usage to database
export async function logUsage(input: UsageLogInput): Promise<string> {
  if (!input.reservationId || !input.memberId) throw new Error("AI usage requires an admitted request");
  const reservation = await prisma.aIUsageLog.findFirst({
    where: { id: input.reservationId, memberId: input.memberId, organizationId: input.organizationId },
    select: { id: true, reservedTokens: true, settledAt: true },
  });
  if (!reservation) throw new Error("AI request reservation not found");
  if (reservation.settledAt) return reservation.id;
  if (reservation.reservedTokens < 1) throw new Error("AI usage requires an admitted request");

  for (const count of [input.usage.promptTokens, input.usage.completionTokens, input.usage.totalTokens]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid AI usage count");
  }
  const costCents = calculateCost(
    input.usage.model,
    input.usage.promptTokens,
    input.usage.completionTokens
  );

  const settled = await prisma.aIUsageLog.updateMany({
    where: { id: reservation.id, memberId: input.memberId, organizationId: input.organizationId, settledAt: null },
    data: {
      memberId: input.memberId,
      organizationId: input.organizationId,
      feature: input.feature,
      endpoint: input.endpoint,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      // Incomplete requests or missing usage can still incur provider charges.
      // Keep its remaining allowance until the daily window passes.
      reservedTokens: input.success === false || input.usageKnown !== true ? Math.max(0, reservation.reservedTokens - input.usage.totalTokens) : 0,
      settledAt: new Date(),
      costCents: Math.round(costCents * 100), // Store as integer cents
      model: input.usage.model,
      latencyMs: input.usage.latencyMs,
      // Usage accounting never stores prompts, completions, or provider error payloads.
      requestSummary: null,
      responseSummary: null,
      success: input.success ?? true,
      errorMessage: input.success === false ? "generation_failed" : null,
    },
  });
  if (settled.count === 0) return reservation.id;

  console.log(
    `[AI Usage] Feature: ${input.feature}, Tokens: ${input.usage.totalTokens}, Cost: $${(costCents / 100).toFixed(4)}`
  );

  return reservation.id;
}

// Get usage summary for a member
export async function getMemberUsageSummary(
  memberId: string,
  days: number = 30
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byFeature: Record<string, { requests: number; tokens: number; cost: number }>;
  byDay: Array<{ date: string; requests: number; tokens: number; cost: number }>;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const logs = await prisma.aIUsageLog.findMany({
    where: {
      memberId,
      createdAt: { gte: startDate },
      success: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byFeature: Record<string, { requests: number; tokens: number; cost: number }> = {};
  const byDayMap: Record<string, { requests: number; tokens: number; cost: number }> = {};

  let totalRequests = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const log of logs) {
    totalRequests++;
    totalTokens += log.totalTokens;
    totalCost += log.costCents;

    // By feature
    if (!byFeature[log.feature]) {
      byFeature[log.feature] = { requests: 0, tokens: 0, cost: 0 };
    }
    byFeature[log.feature].requests++;
    byFeature[log.feature].tokens += log.totalTokens;
    byFeature[log.feature].cost += log.costCents;

    // By day
    const dateKey = log.createdAt.toISOString().split("T")[0];
    if (!byDayMap[dateKey]) {
      byDayMap[dateKey] = { requests: 0, tokens: 0, cost: 0 };
    }
    byDayMap[dateKey].requests++;
    byDayMap[dateKey].tokens += log.totalTokens;
    byDayMap[dateKey].cost += log.costCents;
  }

  // Convert byDayMap to sorted array
  const byDay = Object.entries(byDayMap)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalRequests,
    totalTokens,
    totalCost: totalCost / 100, // Convert back to dollars
    byFeature: Object.fromEntries(
      Object.entries(byFeature).map(([k, v]) => [
        k,
        { ...v, cost: v.cost / 100 },
      ])
    ),
    byDay: byDay.map((d) => ({ ...d, cost: d.cost / 100 })),
  };
}

// Get organization-wide usage summary
export async function getOrganizationUsageSummary(
  organizationId: string,
  days: number = 30
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byFeature: Record<string, { requests: number; tokens: number; cost: number }>;
  byMember: Array<{ memberId: string; requests: number; tokens: number; cost: number }>;
  byDay: Array<{ date: string; requests: number; tokens: number; cost: number }>;
  successRate: number;
  averageLatency: number;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const logs = await prisma.aIUsageLog.findMany({
    where: {
      organizationId,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: "asc" },
  });

  const byFeature: Record<string, { requests: number; tokens: number; cost: number }> = {};
  const byMemberMap: Record<string, { requests: number; tokens: number; cost: number }> = {};
  const byDayMap: Record<string, { requests: number; tokens: number; cost: number }> = {};

  let totalRequests = 0;
  let successfulRequests = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalLatency = 0;

  for (const log of logs) {
    totalRequests++;
    if (log.success) successfulRequests++;
    totalTokens += log.totalTokens;
    totalCost += log.costCents;
    totalLatency += log.latencyMs;

    // By feature
    if (!byFeature[log.feature]) {
      byFeature[log.feature] = { requests: 0, tokens: 0, cost: 0 };
    }
    byFeature[log.feature].requests++;
    byFeature[log.feature].tokens += log.totalTokens;
    byFeature[log.feature].cost += log.costCents;

    // By member
    if (log.memberId) {
      if (!byMemberMap[log.memberId]) {
        byMemberMap[log.memberId] = { requests: 0, tokens: 0, cost: 0 };
      }
      byMemberMap[log.memberId].requests++;
      byMemberMap[log.memberId].tokens += log.totalTokens;
      byMemberMap[log.memberId].cost += log.costCents;
    }

    // By day
    const dateKey = log.createdAt.toISOString().split("T")[0];
    if (!byDayMap[dateKey]) {
      byDayMap[dateKey] = { requests: 0, tokens: 0, cost: 0 };
    }
    byDayMap[dateKey].requests++;
    byDayMap[dateKey].tokens += log.totalTokens;
    byDayMap[dateKey].cost += log.costCents;
  }

  // Convert to arrays and sort
  const byMember = Object.entries(byMemberMap)
    .map(([memberId, data]) => ({ memberId, ...data, cost: data.cost / 100 }))
    .sort((a, b) => b.tokens - a.tokens);

  const byDay = Object.entries(byDayMap)
    .map(([date, data]) => ({ date, ...data, cost: data.cost / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalRequests,
    totalTokens,
    totalCost: totalCost / 100,
    byFeature: Object.fromEntries(
      Object.entries(byFeature).map(([k, v]) => [
        k,
        { ...v, cost: v.cost / 100 },
      ])
    ),
    byMember,
    byDay,
    successRate: totalRequests > 0 ? successfulRequests / totalRequests : 1,
    averageLatency: totalRequests > 0 ? totalLatency / totalRequests : 0,
  };
}

// Get recent error logs
export async function getRecentErrors(
  organizationId: string,
  limit: number = 20
): Promise<
  Array<{
    id: string;
    feature: string;
    errorMessage: string | null;
    createdAt: Date;
    memberId: string | null;
  }>
> {
  const errors = await prisma.aIUsageLog.findMany({
    where: {
      organizationId,
      success: false,
    },
    select: {
      id: true,
      feature: true,
      errorMessage: false,
      createdAt: true,
      memberId: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return errors.map((error) => ({ ...error, errorMessage: "generation_failed" }));
}

// Calculate estimated monthly cost based on current usage
export async function estimateMonthlyUsage(
  organizationId: string
): Promise<{
  estimatedTokens: number;
  estimatedCost: number;
  projectionBasis: string;
}> {
  // Get usage from the last 7 days for projection
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentUsage = await prisma.aIUsageLog.aggregate({
    where: {
      organizationId,
      createdAt: { gte: sevenDaysAgo },
      success: true,
    },
    _sum: {
      totalTokens: true,
      costCents: true,
    },
    _count: { id: true },
  });

  const tokensPerWeek = recentUsage._sum.totalTokens || 0;
  const costPerWeek = (recentUsage._sum.costCents || 0) / 100;
  const requestsPerWeek = recentUsage._count.id;

  // Project to monthly (4.33 weeks per month)
  const weeksPerMonth = 4.33;
  const estimatedTokens = Math.round(tokensPerWeek * weeksPerMonth);
  const estimatedCost = costPerWeek * weeksPerMonth;

  return {
    estimatedTokens,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    projectionBasis: `Based on ${requestsPerWeek} requests over the last 7 days`,
  };
}
