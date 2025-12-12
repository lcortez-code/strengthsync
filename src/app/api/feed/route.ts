import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiListSuccess, apiError, ApiErrorCode } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const organizationId = session.user.organizationId;
    const memberId = session.user.memberId;

    if (!organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // Filter by type
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const where: Record<string, unknown> = { organizationId };

    if (type) {
      where.itemType = type;
    }

    const total = await prisma.feedItem.count({ where });

    const feedItems = await prisma.feedItem.findMany({
      where,
      include: {
        creator: {
          include: {
            user: { select: { fullName: true, avatarUrl: true, jobTitle: true } },
          },
        },
        shoutout: {
          include: {
            receiver: {
              include: {
                user: { select: { fullName: true, avatarUrl: true } },
              },
            },
            theme: {
              include: {
                domain: { select: { slug: true } },
              },
            },
          },
        },
        skillRequest: {
          include: {
            theme: {
              include: {
                domain: { select: { slug: true } },
              },
            },
            _count: { select: { responses: true } },
          },
        },
        challenge: {
          select: {
            name: true,
            challengeType: true,
            status: true,
          },
        },
        reactions: {
          include: {
            member: {
              include: {
                user: { select: { fullName: true, avatarUrl: true } },
              },
            },
          },
        },
        comments: {
          include: {
            author: {
              include: {
                user: { select: { fullName: true, avatarUrl: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 3, // Only show first 3 comments initially
        },
        _count: {
          select: { comments: true, reactions: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = feedItems.map((item) => {
      const myReaction = item.reactions.find((r) => r.memberId === memberId);

      return {
        id: item.id,
        type: item.itemType,
        content: item.content,
        createdAt: item.createdAt.toISOString(),
        creator: {
          id: item.creatorId,
          name: item.creator.user.fullName,
          avatarUrl: item.creator.user.avatarUrl,
          jobTitle: item.creator.user.jobTitle,
        },
        // Type-specific data
        shoutout: item.shoutout ? {
          message: item.shoutout.message,
          receiver: {
            id: item.shoutout.receiverId,
            name: item.shoutout.receiver.user.fullName,
            avatarUrl: item.shoutout.receiver.user.avatarUrl,
          },
          theme: item.shoutout.theme ? {
            name: item.shoutout.theme.name,
            domain: item.shoutout.theme.domain.slug,
          } : null,
        } : null,
        skillRequest: item.skillRequest ? {
          id: item.skillRequest.id,
          title: item.skillRequest.title,
          status: item.skillRequest.status,
          urgency: item.skillRequest.urgency,
          responseCount: item.skillRequest._count.responses,
          theme: item.skillRequest.theme ? {
            name: item.skillRequest.theme.name,
            domain: item.skillRequest.theme.domain.slug,
          } : null,
        } : null,
        challenge: item.challenge ? {
          name: item.challenge.name,
          type: item.challenge.challengeType,
          status: item.challenge.status,
        } : null,
        // Engagement
        reactions: {
          count: item._count.reactions,
          items: item.reactions.slice(0, 5).map((r) => ({
            id: r.id,
            emoji: r.emoji,
            memberName: r.member.user.fullName,
          })),
          myReaction: myReaction?.emoji || null,
        },
        comments: {
          count: item._count.comments,
          items: item.comments.map((c) => ({
            id: c.id,
            content: c.content,
            author: {
              id: c.authorId,
              name: c.author.user.fullName,
              avatarUrl: c.author.user.avatarUrl,
            },
            createdAt: c.createdAt.toISOString(),
          })),
        },
        isOwner: item.creatorId === memberId,
      };
    });

    return apiListSuccess(data, {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("Error fetching feed:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to fetch feed");
  }
}
