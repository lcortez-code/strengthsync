import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, ApiErrorCode } from "@/lib/api/response";
import { sendEmail, isEmailConfigured } from "@/lib/email/resend";
import {
  getDigestRecipients,
  getUserDigestData,
  wasDigestSent,
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
        headers: { "Content-Type": "text/html" },
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
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Return JSON data
    return apiSuccess({
      period: { start, end },
      data: { ...digestData, aiNarrative },
      emailConfigured: isEmailConfigured(),
    });
  } catch (error) {
    console.error("[Digest Preview] Error:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to generate digest preview");
  }
}

/**
 * POST /api/email/digest
 * Send weekly digest emails to all eligible users
 *
 * This endpoint is designed to be called by:
 * 1. Vercel Cron Jobs (with CRON_SECRET header)
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
    // 3. Query param - ?secret=CRON_SECRET (for external cron services)
    const authHeader = request.headers.get("authorization");
    const cronSecretHeader = request.headers.get("x-cron-secret");
    const secretParam = searchParams.get("secret");
    const expectedSecret = process.env.CRON_SECRET;

    const isCronJob =
      (authHeader && authHeader === `Bearer ${expectedSecret}`) ||
      cronSecretHeader === expectedSecret ||
      secretParam === expectedSecret;

    if (!isCronJob) {
      // Must be authenticated admin
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return apiError(ApiErrorCode.UNAUTHORIZED, "Authentication required");
      }

      // Check admin role
      if (session.user.role !== "ADMIN" && session.user.role !== "OWNER") {
        return apiError(ApiErrorCode.FORBIDDEN, "Admin access required");
      }
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

    // Get recipients
    let recipients = await getDigestRecipients();

    // Filter for test mode or specific user
    if (isTest) {
      const session = await getServerSession(authOptions);
      if (session?.user?.id) {
        recipients = recipients.filter((r) => r.userId === session.user.id);
      }
    } else if (targetUserId) {
      recipients = recipients.filter((r) => r.userId === targetUserId);
    }

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
        // Check if already sent
        const alreadySent = await wasDigestSent(recipient.userId, start, end);
        if (alreadySent && !isTest) {
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

        // Create log entry
        const logEntry = await prisma.emailDigestLog.create({
          data: {
            userId: recipient.userId,
            digestType: "WEEKLY",
            periodStart: start,
            periodEnd: end,
            shoutoutsGiven: digestData.shoutoutsGiven,
            shoutoutsReceived: digestData.shoutoutsReceived.length,
            pointsEarned: digestData.pointsEarned,
            badgesEarned: digestData.badgesEarned.length,
            challengesActive: digestData.activeChallenges.length,
            status: "PENDING",
          },
        });

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
          where: { id: logEntry.id },
          data: {
            status: emailResult.success ? "SENT" : "FAILED",
            messageId: emailResult.messageId,
            error: emailResult.error,
            sentAt: emailResult.success ? new Date() : null,
          },
        });

        if (emailResult.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(`${recipient.userEmail}: ${emailResult.error}`);
        }
      } catch (err) {
        results.failed++;
        results.errors.push(
          `${recipient.userEmail}: ${err instanceof Error ? err.message : "Unknown error"}`
        );
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
    console.error("[Weekly Digest] Error:", error);
    return apiError(ApiErrorCode.INTERNAL_ERROR, "Failed to send weekly digest");
  }
}
