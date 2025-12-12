import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiCreated, apiListSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const createRequestSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(2000),
  themeId: z.string().optional(),
  domainNeeded: z.string().optional(),
  urgency: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  deadline: z.string().datetime().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // OPEN, IN_PROGRESS, FULFILLED, CLOSED
    const urgency = searchParams.get("urgency");
    const domain = searchParams.get("domain");
    const mine = searchParams.get("mine") === "true";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    const memberId = session.user.memberId;

    const where: Record<string, unknown> = { organizationId };

    if (status) {
      where.status = status;
    }
    if (urgency) {
      where.urgency = urgency;
    }
    if (domain) {
      where.domainNeeded = domain;
    }
    if (mine && memberId) {
      where.creatorId = memberId;
    }

    const total = await prisma.skillRequest.count({ where });

    const requests = await prisma.skillRequest.findMany({
      where,
      include: {
        creator: {
          include: {
            user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
          },
        },
        theme: {
          include: {
            domain: { select: { slug: true, colorHex: true } },
          },
        },
        responses: {
          include: {
            responder: {
              include: {
                user: { select: { fullName: true, avatarUrl: true } },
              },
            },
          },
        },
        _count: {
          select: { responses: true },
        },
      },
      orderBy: [
        { urgency: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = requests.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      urgency: r.urgency,
      deadline: r.deadline?.toISOString(),
      domainNeeded: r.domainNeeded,
      theme: r.theme ? {
        id: r.themeId,
        name: r.theme.name,
        domain: r.theme.domain.slug,
        domainColor: r.theme.domain.colorHex,
      } : null,
      creator: {
        id: r.creatorId,
        name: r.creator.user.fullName,
        avatarUrl: r.creator.user.avatarUrl,
        jobTitle: r.creator.user.jobTitle,
      },
      responseCount: r._count.responses,
      responses: r.responses.map((resp) => ({
        id: resp.id,
        message: resp.message,
        status: resp.status,
        responder: {
          id: resp.responderId,
          name: resp.responder.user.fullName,
          avatarUrl: resp.responder.user.avatarUrl,
        },
        createdAt: resp.createdAt.toISOString(),
      })),
      isOwner: r.creatorId === memberId,
      createdAt: r.createdAt.toISOString(),
    }));

    return apiListSuccess(data, {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("Error fetching skill requests:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch skill requests");
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

    if (!organizationId || !memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const body = await request.json();
    const validation = createRequestSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { title, description, themeId, domainNeeded, urgency, deadline } = validation.data;

    // Verify theme exists if provided
    if (themeId) {
      const theme = await prisma.strengthTheme.findUnique({ where: { id: themeId } });
      if (!theme) {
        return apiError(ApiErrorCode.NOT_FOUND, "Theme not found");
      }
    }

    const skillRequest = await prisma.skillRequest.create({
      data: {
        organizationId,
        creatorId: memberId,
        title,
        description,
        themeId,
        domainNeeded,
        urgency,
        deadline: deadline ? new Date(deadline) : null,
        status: "OPEN",
      },
      include: {
        creator: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        theme: true,
      },
    });

    // Create feed item for the skill request
    await prisma.feedItem.create({
      data: {
        organizationId,
        creatorId: memberId,
        itemType: "SKILL_REQUEST",
        skillRequestId: skillRequest.id,
        content: JSON.parse(JSON.stringify({
          title: skillRequest.title,
          urgency: skillRequest.urgency,
          domainNeeded: skillRequest.domainNeeded,
        })),
      },
    });

    return apiCreated({
      id: skillRequest.id,
      title: skillRequest.title,
      status: skillRequest.status,
      urgency: skillRequest.urgency,
      createdAt: skillRequest.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Error creating skill request:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to create skill request");
  }
}
