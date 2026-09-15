import { boundedPageNumber } from "@/lib/api/pagination";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { canViewFullProfile, isManagerOrAbove } from "@/lib/auth/permissions";
import { apiSuccess, apiListSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "No organization associated with user");
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const domainFilter = searchParams.get("domain");
    const themeFilter = searchParams.get("theme");
    const page = boundedPageNumber(searchParams.get("page"), 1, 10000);
    const limit = boundedPageNumber(searchParams.get("limit"), 20, 100);

    // Build where clause
    const where: Record<string, unknown> = {
      organizationId,
      status: "ACTIVE",
    };

    // Strength filters must not reveal a peer's hidden ranks through search results.
    const visibleStrengthFilter = (theme: Record<string, unknown>) => {
      const match = (rank: number) => ({ strengths: { some: { theme, rank: { lte: rank } } } });
      if (isManagerOrAbove(session.user.role)) return match(10);
      return {
        OR: [
          match(5),
          ...(session.user.memberId ? [{ id: session.user.memberId, ...match(10) }] : []),
        ],
      };
    };

    // Enhanced search - searches across name, email, job title, department, and strength themes
    if (search) {
      where.OR = [
        {
          user: {
            fullName: { contains: search, mode: "insensitive" },
          },
        },
        {
          user: {
            email: { contains: search, mode: "insensitive" },
          },
        },
        {
          user: {
            jobTitle: { contains: search, mode: "insensitive" },
          },
        },
        {
          user: {
            department: { contains: search, mode: "insensitive" },
          },
        },
        visibleStrengthFilter({ name: { contains: search, mode: "insensitive" } }),
      ];
    }

    // Filter by theme and/or domain
    if (themeFilter || domainFilter) {
      const theme = {
        ...(themeFilter ? { slug: themeFilter } : {}),
        ...(domainFilter ? { domain: { slug: domainFilter } } : {}),
      };
      where.AND = [visibleStrengthFilter(theme)];
    }

    // Get total count
    const total = await prisma.organizationMember.count({ where });

    // Get members
    const members = await prisma.organizationMember.findMany({
      where,
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            avatarUrl: true,
            jobTitle: true,
            department: true,
          },
        },
        strengths: {
          where: { rank: { lte: 5 } },
          include: {
            theme: {
              include: {
                domain: {
                  select: { slug: true, name: true },
                },
              },
            },
          },
          orderBy: { rank: "asc" },
        },
      },
      orderBy: [
        { user: { fullName: "asc" } },
      ],
      skip: (page - 1) * limit,
      take: limit,
    });

    // Format response
    const data = members.map((m) => ({
      id: m.id,
      name: m.user.fullName || "Unknown",
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      jobTitle: m.user.jobTitle,
      department: m.user.department,
      ...(canViewFullProfile({
        viewerRole: session.user.role,
        viewerMemberId: session.user.memberId,
        targetMemberId: m.id,
      }) ? { points: m.points } : {}),
      topStrengths: m.strengths
        .filter((s) => s.theme?.domain)
        .map((s) => ({
          rank: s.rank,
          themeName: s.theme.name,
          themeSlug: s.theme.slug,
          domain: s.theme.domain.slug,
        })),
    }));

    return apiListSuccess(data, {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("Error fetching members");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch members");
  }
}
