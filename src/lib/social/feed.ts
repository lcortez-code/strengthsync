import type { Prisma } from "@prisma/client";

export function publicFeedWhere(organizationId: string): Prisma.FeedItemWhereInput {
  return {
    organizationId,
    OR: [{ shoutoutId: null }, { shoutout: { isPublic: true } }],
  };
}
