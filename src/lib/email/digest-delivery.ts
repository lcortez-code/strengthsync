import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export function isDigestScheduler(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected?.trim()) return false;
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : request.headers.get("x-cron-secret");
  if (!provided) return false;
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function claimDigestDelivery(recipient: { userId: string; organizationId: string; memberId: string }, start: Date, end: Date, isTest = false): Promise<string | null> {
  // Historical deliveries lack tenant attribution. Keep ambiguous deliveries suppressed.
  if (!isTest && await prisma.emailDigestLog.findFirst({ where: {
    userId: recipient.userId, deliveryKey: null, digestType: "WEEKLY", periodStart: start, periodEnd: end,
  }, select: { id: true } })) return null;
  const deliveryKey = createHash("sha256").update(JSON.stringify([
    "WEEKLY", recipient.organizationId, recipient.userId, start.toISOString(), end.toISOString(),
    ...(isTest ? [randomUUID()] : []),
  ])).digest("hex");
  try {
    const entry = await prisma.emailDigestLog.create({ data: {
      ...recipient, deliveryKey, digestType: "WEEKLY", periodStart: start, periodEnd: end, status: "PENDING",
    }, select: { id: true } });
    return entry.id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  }
}
