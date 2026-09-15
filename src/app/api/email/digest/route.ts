import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { consumeAuthLimits, authProtectionResponse } from "@/lib/auth/request-protection";
import { claimDigestDelivery, isDigestScheduler } from "@/lib/email/digest-delivery";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { sendEmail, isEmailConfigured } from "@/lib/email/resend";
import {
  getDigestRecipients,
  getUserDigestData,
  getWeeklyDigestPeriod,
  generateDigestNarrative,
} from "@/lib/email/digest-service";
import {
  generateWeeklyDigestHtml,
  generateWeeklyDigestText,
} from "@/lib/email/templates/weekly-digest";

/**
 * GET /api/email/digest
 * Preview the current user's digest email (for testing)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
    }

    const memberId = session.user.memberId;
    const organizationId = session.user.organizationId;

    if (!memberId || !organizationId) {
      return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");
    const includeAI = searchParams.get("ai") !== "false"; // Default to including AI

    // For preview (html/text format), show current week's data so users see recent activity
    const isPreview = format === "html" || format === "text";
    const { start, end } = getWeeklyDigestPeriod(isPreview);

    const digestData = await getUserDigestData(
      session.user.id,
      memberId,
      organizationId,
      start,
      end
    );

    // Generate AI narrative if requested
    let aiNarrative: string | null = null;
    if (includeAI) {
      aiNarrative = await generateDigestNarrative(memberId, organizationId, digestData);
    }

    if (format === "html") {
      const html = generateWeeklyDigestHtml({
        ...digestData,
        aiNarrative: aiNarrative || undefined,
        userEmail: session.user.email || "",
        unsubscribeUrl: `${process.env.NEXTAUTH_URL}/settings/notifications?unsubscribe=weekly`,
      });

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox; default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      });
    }

    if (format === "text") {
      const text = generateWeeklyDigestText({
        ...digestData,
        aiNarrative: aiNarrative || undefined,
        userEmail: session.user.email || "",
        unsubscribeUrl: `${process.env.NEXTAUTH_URL}/settings/notifications?unsubscribe=weekly`,
      });

      return new Response(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }

    // Return JSON data
    const response = apiSuccess({
      period: { start, end },
      data: { ...digestData, aiNarrative },
      emailConfigured: isEmailConfigured(),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("[Digest Preview] Failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate digest preview");
  }
}

/**
 * POST /api/email/digest
 * Send weekly digest emails to all eligible users
 *
 * This endpoint is designed to be called by:
 * 1. Authenticated scheduler dispatch (via /api/cron/weekly-digest)
 * 2. Admin users manually (authenticated)
 *
 * Query params:
 * - test=true: Only send to current user (for testing)
 * - userId=<id>: Send to specific user (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isTest = searchParams.get("test") === "true";
    const targetUserId = searchParams.get("userId");

    // Check authentication
    // Support multiple auth methods for cron jobs:
    // 1. Vercel Cron - adds authorization header with CRON_SECRET
    // 2. Manual header - x-cron-secret
    const isCronJob = isDigestScheduler(request);

    // Test sends always require a user and stay within that user's organization,
    // even when the request also has a valid scheduler credential.
    const session = !isCronJob || isTest ? await getServerSession(authOptions) : null;
    if (!isCronJob || isTest) {
      if (!session?.user?.id) {
        return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
      }

      if (!session.user.organizationId || !session.user.memberId) {
        return apiError(ApiErrorCode.BAD_REQUEST, "Organization membership required");
      }

      // Check admin role
      if (!isCronJob && session.user.role !== "ADMIN" && session.user.role !== "OWNER") {
        return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
      }
    }

    if (isTest) {
      await consumeAuthLimits([
        { scope: "digest-test:global", identity: "global", limit: 100 },
        { scope: "digest-test:organization", identity: session!.user.organizationId!, limit: 10 },
        { scope: "digest-test:recipient", identity: session!.user.id, limit: 3 },
      ]);
    }

    // Check email configuration
    if (!isEmailConfigured()) {
      return apiError(
        ApiErrorCode.BAD_REQUEST,
        "Email service not configured. Set RESEND_API_KEY environment variable."
      );
    }

    const { start, end } = getWeeklyDigestPeriod();
    const appUrl = process.env.NEXTAUTH_URL || "https://strengthsync.app";

    // Only scheduler dispatch may span organizations. Scope is applied in the
    // database query so tenant administrators never load another tenant's recipients.
    const recipients = await getDigestRecipients({
      organizationId: session?.user.organizationId,
      userId: isTest ? session!.user.id : targetUserId || undefined,
    });

    if (recipients.length === 0) {
      return apiSuccess({
        sent: 0,
        failed: 0,
        skipped: 0,
        message: "No eligible recipients found",
      });
    }

    const results = {
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Process each recipient
    for (const recipient of recipients) {
      try {
        // Claim before generating content or sending; concurrent dispatch cannot win twice.
        const deliveryId = await claimDigestDelivery({ userId: recipient.userId, memberId: recipient.memberId, organizationId: recipient.organizationId }, start, end, isTest);
        if (!deliveryId) {
          results.skipped++;
          continue;
        }

        // Get digest data
        const digestData = await getUserDigestData(
          recipient.userId,
          recipient.memberId,
          recipient.organizationId,
          start,
          end
        );

        // Skip if no activity
        if (
          digestData.shoutoutsReceived.length === 0 &&
          digestData.shoutoutsGiven === 0 &&
          digestData.pointsEarned === 0 &&
          digestData.badgesEarned.length === 0 &&
          digestData.activeChallenges.length === 0
        ) {
          await prisma.emailDigestLog.update({ where: { id: deliveryId }, data: { status: "SKIPPED" } });
          results.skipped++;
          continue;
        }

        // Generate AI narrative for personalized digest
        const aiNarrative = await generateDigestNarrative(
          recipient.memberId,
          recipient.organizationId,
          digestData
        );

        const unsubscribeUrl = `${appUrl}/settings/notifications?unsubscribe=weekly`;

        // Generate email content
        const html = generateWeeklyDigestHtml({
          ...digestData,
          aiNarrative: aiNarrative || undefined,
          userEmail: recipient.userEmail,
          unsubscribeUrl,
        });

        const text = generateWeeklyDigestText({
          ...digestData,
          aiNarrative: aiNarrative || undefined,
          userEmail: recipient.userEmail,
          unsubscribeUrl,
        });

        await prisma.emailDigestLog.update({ where: { id: deliveryId }, data: {
          shoutoutsGiven: digestData.shoutoutsGiven,
          shoutoutsReceived: digestData.shoutoutsReceived.length,
          pointsEarned: digestData.pointsEarned,
          badgesEarned: digestData.badgesEarned.length,
          challengesActive: digestData.activeChallenges.length,
        } });

        // Send email
        const emailResult = await sendEmail({
          to: recipient.userEmail,
          subject: `Your Weekly StrengthSync Digest - ${recipient.organizationName}`,
          html,
          text,
          tags: [
            { name: "type", value: "weekly-digest" },
            { name: "organization", value: recipient.organizationId },
          ],
        });

        // Update log entry
        await prisma.emailDigestLog.update({
          where: { id: deliveryId },
          data: {
            status: emailResult.success ? "SENT" : "FAILED",
            messageId: emailResult.messageId,
            error: emailResult.success ? null : "delivery_failed",
            sentAt: emailResult.success ? new Date() : null,
          },
        });

        if (emailResult.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push("Email delivery failed");
        }
      } catch (err) {
        results.failed++;
        // A failed or interrupted send keeps its claim for operator reconciliation.
        results.errors.push("Digest processing failed; delivery requires reconciliation");
      }
    }

    console.log("[Weekly Digest] Results:", results);

    return apiSuccess({
      sent: results.sent,
      failed: results.failed,
      skipped: results.skipped,
      period: { start, end },
      ...(results.errors.length > 0 && { errors: results.errors }),
    });
  } catch (error) {
    const protectedResponse = authProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    console.error("[Weekly Digest] Failed");
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to send weekly digest");
  }
}
