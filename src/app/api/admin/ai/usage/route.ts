import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const role = session.user.role;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Only admins can view AI usage
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "week"; // week, month, all
    const feature = searchParams.get("feature"); // optional filter

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case "month":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "all":
        startDate = new Date(0);
        break;
      default: // week
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Build where clause
    const where: Record<string, unknown> = {
      organizationId,
      createdAt: { gte: startDate },
    };

    if (feature) {
      where.feature = feature;
    }

    // Get aggregated usage stats
    const [
      totalUsage,
      usageByFeature,
      usageByMember,
      dailyUsage,
      recentLogs,
    ] = await Promise.all([
      // Total usage
      prisma.aIUsageLog.aggregate({
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costCents: true,
        },
        _count: true,
        _avg: {
          latencyMs: true,
        },
      }),

      // Usage by feature
      prisma.aIUsageLog.groupBy({
        by: ["feature"],
        where,
        _sum: {
          totalTokens: true,
          costCents: true,
        },
        _count: true,
        _avg: {
          latencyMs: true,
        },
        orderBy: {
          _count: {
            feature: "desc",
          },
        },
      }),

      // Usage by member (top 10)
      prisma.aIUsageLog.groupBy({
        by: ["memberId"],
        where: {
          ...where,
          memberId: { not: null },
        },
        _sum: {
          totalTokens: true,
          costCents: true,
        },
        _count: true,
        orderBy: {
          _sum: {
            totalTokens: "desc",
          },
        },
        take: 10,
      }),

      // Daily usage (for chart)
      prisma.$queryRaw<{ date: Date; requests: bigint; tokens: bigint; cost: bigint }[]>`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as requests,
          SUM(total_tokens) as tokens,
          SUM(cost_cents) as cost
        FROM "AIUsageLog"
        WHERE organization_id = ${organizationId}
          AND created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `,

      // Recent logs
      prisma.aIUsageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          memberId: true,
          feature: true,
          model: true,
          totalTokens: true,
          costCents: true,
          latencyMs: true,
          success: true,
          createdAt: true,
        },
      }),
    ]);

    // Get member names for top users and recent logs
    const allMemberIds = [
      ...usageByMember.map((u) => u.memberId),
      ...recentLogs.map((l) => l.memberId),
    ].filter((id): id is string => id !== null);

    const uniqueMemberIds = [...new Set(allMemberIds)];

    const members = await prisma.organizationMember.findMany({
      where: { id: { in: uniqueMemberIds } },
      select: {
        id: true,
        user: { select: { fullName: true } },
      },
    });

    const memberNameMap = new Map(
      members.map((m) => [m.id, m.user.fullName])
    );

    // Format the response
    const response = {
      summary: {
        totalRequests: totalUsage._count,
        totalTokens: totalUsage._sum.totalTokens || 0,
        promptTokens: totalUsage._sum.promptTokens || 0,
        completionTokens: totalUsage._sum.completionTokens || 0,
        totalCostCents: totalUsage._sum.costCents || 0,
        totalCostDollars: ((totalUsage._sum.costCents || 0) / 100).toFixed(2),
        avgLatencyMs: Math.round(totalUsage._avg.latencyMs || 0),
      },
      byFeature: usageByFeature.map((f) => ({
        feature: f.feature,
        requests: f._count,
        tokens: f._sum.totalTokens || 0,
        costCents: f._sum.costCents || 0,
        avgLatencyMs: Math.round(f._avg.latencyMs || 0),
      })),
      byMember: usageByMember.map((m) => ({
        memberId: m.memberId,
        memberName: m.memberId ? memberNameMap.get(m.memberId) || "Unknown" : "System",
        requests: m._count,
        tokens: m._sum.totalTokens || 0,
        costCents: m._sum.costCents || 0,
      })),
      daily: dailyUsage.map((d) => ({
        date: d.date,
        requests: Number(d.requests),
        tokens: Number(d.tokens),
        costCents: Number(d.cost),
      })),
      recentLogs: recentLogs.map((log) => ({
        id: log.id,
        feature: log.feature,
        model: log.model,
        tokens: log.totalTokens,
        costCents: log.costCents,
        latencyMs: log.latencyMs,
        success: log.success,
        memberName: log.memberId ? memberNameMap.get(log.memberId) || "Unknown" : "System",
        createdAt: log.createdAt,
      })),
      period,
      startDate,
      endDate: now,
    };

    return apiSuccess(response);
  } catch (error) {
    console.error("[Admin AI Usage Error]", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch AI usage data");
  }
}
