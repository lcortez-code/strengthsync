import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { z } from "zod";

const updateRequestSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "FULFILLED", "CLOSED"]).optional(),
  title: z.string().min(5).max(200).optional(),
  description: z.string().min(20).max(2000).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const skillRequest = await prisma.skillRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      include: {
        creator: {
          include: {
            user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
            strengths: {
              where: { rank: { lte: 5 } },
              include: {
                theme: { include: { domain: { select: { slug: true } } } },
              },
              orderBy: { rank: "asc" },
            },
          },
        },
        theme: {
          include: {
            domain: { select: { slug: true, colorHex: true, name: true } },
          },
        },
        responses: {
          include: {
            responder: {
              include: {
                user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
                strengths: {
                  where: { rank: { lte: 5 } },
                  include: {
                    theme: { include: { domain: { select: { slug: true } } } },
                  },
                  orderBy: { rank: "asc" },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!skillRequest) {
      return apiError(ApiErrorCode.NOT_FOUND, "Skill request not found");
    }

    return apiSuccess({
      id: skillRequest.id,
      title: skillRequest.title,
      description: skillRequest.description,
      status: skillRequest.status,
      urgency: skillRequest.urgency,
      deadline: skillRequest.deadline?.toISOString(),
      domainNeeded: skillRequest.domainNeeded,
      theme: skillRequest.theme ? {
        id: skillRequest.themeId,
        name: skillRequest.theme.name,
        domain: {
          slug: skillRequest.theme.domain.slug,
          name: skillRequest.theme.domain.name,
          colorHex: skillRequest.theme.domain.colorHex,
        },
      } : null,
      creator: {
        id: skillRequest.creatorId,
        name: skillRequest.creator.user.fullName,
        avatarUrl: skillRequest.creator.user.avatarUrl,
        jobTitle: skillRequest.creator.user.jobTitle,
        topStrengths: skillRequest.creator.strengths.map((s) => ({
          name: s.theme.name,
          domain: s.theme.domain.slug,
        })),
      },
      responses: skillRequest.responses.map((resp) => ({
        id: resp.id,
        message: resp.message,
        status: resp.status,
        responder: {
          id: resp.responderId,
          name: resp.responder.user.fullName,
          avatarUrl: resp.responder.user.avatarUrl,
          jobTitle: resp.responder.user.jobTitle,
          topStrengths: resp.responder.strengths.map((s) => ({
            name: s.theme.name,
            domain: s.theme.domain.slug,
          })),
        },
        createdAt: resp.createdAt.toISOString(),
      })),
      isOwner: skillRequest.creatorId === memberId,
      hasResponded: skillRequest.responses.some((r) => r.responderId === memberId),
      createdAt: skillRequest.createdAt.toISOString(),
      updatedAt: skillRequest.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error fetching skill request:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch skill request");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;

    if (!organizationId || !memberId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const skillRequest = await prisma.skillRequest.findFirst({
      where: { id: requestId, organizationId },
    });

    if (!skillRequest) {
      return apiError(ApiErrorCode.NOT_FOUND, "Skill request not found");
    }

    if (skillRequest.creatorId !== memberId) {
      return apiError(ApiErrorCode.FORBIDDEN, "Only the creator can update this request");
    }

    const body = await request.json();
    const validation = updateRequestSchema.safeParse(body);

    if (!validation.success) {
      return apiError(ApiErrorCode.VALIDATION_ERROR, "Invalid input", {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const updated = await prisma.skillRequest.update({
      where: { id: requestId },
      data: validation.data,
    });

    return apiSuccess({
      id: updated.id,
      status: updated.status,
      title: updated.title,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error updating skill request:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to update skill request");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;
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

    const skillRequest = await prisma.skillRequest.findFirst({
      where: { id: requestId, organizationId },
    });

    if (!skillRequest) {
      return apiError(ApiErrorCode.NOT_FOUND, "Skill request not found");
    }

    // Only creator or admin can delete
    if (skillRequest.creatorId !== memberId && role !== "OWNER" && role !== "ADMIN") {
      return apiError(ApiErrorCode.FORBIDDEN, "Not authorized to delete this request");
    }

    await prisma.skillRequest.delete({ where: { id: requestId } });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error deleting skill request:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to delete skill request");
  }
}
