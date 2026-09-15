import { readAuthJson as readBoundedJson, authProtectionResponse } from "@/lib/auth/request-protection";
import { parseChallengeRules, ChallengeRulesError } from "@/lib/challenges/rules";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiListSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const createChallengeSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(500),
  challengeType: z.enum([
    "STRENGTHS_BINGO",
    "SHOUTOUT_STREAK",
    "MENTORSHIP_MONTH",
    "COLLABORATION_QUEST",
    "MANIFESTO_EXERCISE",
    "THEME_OF_THE_WEEK",
  ]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  rules: z.unknown().optional(),
});

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
    const status = searchParams.get("status"); // UPCOMING, ACTIVE, COMPLETED
    const requestedPage = Number(searchParams.get("page") || "1");
    const requestedLimit = Number(searchParams.get("limit") || "10");
    const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(10000, requestedPage)) : 1;
    const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 10;

    const memberId = session.user.memberId;

    const where: Record<string, unknown> = { organizationId };
    if (status) {
      where.status = status;
    }

    const total = await prisma.teamChallenge.count({ where });

    const challenges = await prisma.teamChallenge.findMany({
      where,
      include: {
        participants: {
          where: { member: { organizationId, status: "ACTIVE" } },
          include: {
            member: {
              include: {
                user: { select: { fullName: true, avatarUrl: true } },
              },
            },
          },
          orderBy: { score: "desc" },
          take: 5,
        },
        _count: {
          select: { participants: { where: { member: { organizationId, status: "ACTIVE" } } } },
        },
      },
      orderBy: [{ status: "asc" }, { startsAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = challenges.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      challengeType: c.challengeType,
      status: c.status,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      rules: c.rules,
      rewards: c.rewards,
      participantCount: c._count.participants,
      topParticipants: c.participants.map((p) => ({
        id: p.memberId,
        name: p.member.user.fullName,
        avatarUrl: p.member.user.avatarUrl,
        score: p.score,
        completedAt: p.completedAt?.toISOString(),
      })),
      isParticipating: memberId
        ? c.participants.some((p) => p.memberId === memberId)
        : false,
      myProgress: memberId
        ? c.participants.find((p) => p.memberId === memberId)?.progress
        : null,
    }));

    return apiListSuccess(data, {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("Error fetching challenges:");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch challenges");
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;
    const role = session.user.role;

    if (!organizationId || !memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Only admins can create challenges
    if (role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Only admins can create challenges");
    }

    const body = await readBoundedJson(request);
    const validation = createChallengeSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { name, description, challengeType, startsAt, endsAt, rules } = validation.data;

    // Determine initial status
    const now = new Date();
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);

    if (endDate <= startDate) return apiError(ApiErrorCode.VALIDATION_ERROR, "End date must be after start date");

    let status: "UPCOMING" | "ACTIVE" | "COMPLETED" = "UPCOMING";
    if (now >= startDate && now < endDate) {
      status = "ACTIVE";
    } else if (now >= endDate) {
      status = "COMPLETED";
    }

    // Generate rules based on challenge type
    const validatedRules = parseChallengeRules(challengeType, rules);

    const challenge = await prisma.teamChallenge.create({
      data: {
        organizationId,
        name,
        description,
        challengeType,
        startsAt: startDate,
        endsAt: endDate,
        status,
        rules: JSON.parse(JSON.stringify(validatedRules)),
        rewards: JSON.parse(JSON.stringify({ points: 50, badge: `${challengeType.toLowerCase()}-champion` })),
      },
    });

    return apiCreated({
      id: challenge.id,
      name: challenge.name,
      challengeType: challenge.challengeType,
      status: challenge.status,
      startsAt: challenge.startsAt.toISOString(),
      endsAt: challenge.endsAt.toISOString(),
    });
  } catch (error) {
    const protection = authProtectionResponse(error);
    if (protection) return protection;
    if (error instanceof ChallengeRulesError) return apiError(ApiErrorCode.VALIDATION_ERROR, error.message);
    console.error("Challenge creation failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create challenge");
  }
}
