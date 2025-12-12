import { Resend } from "resend";

// Lazy initialization of Resend client
let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

// Email sender configuration
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "StrengthSync <noreply@strengthsync.app>";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email using Resend
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
  const { to, subject, html, text, replyTo, tags } = options;

  try {
    const client = getResendClient();
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      replyTo,
      tags,
    });

    if (error) {
      console.error("[Email] Failed to send:", error);
      return { success: false, error: error.message };
    }

    console.log("[Email] Sent successfully:", data?.id);
    return { success: true, messageId: data?.id };
  } catch (err) {
    console.error("[Email] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Send batch emails (up to 100 at a time)
 */
export async function sendBatchEmails(
  emails: Array<Omit<SendEmailOptions, "from">>
): Promise<{ successful: number; failed: number }> {
  const results = { successful: 0, failed: 0 };

  // Resend batch limit is 100 emails
  const batches = [];
  for (let i = 0; i < emails.length; i += 100) {
    batches.push(emails.slice(i, i + 100));
  }

  for (const batch of batches) {
    const batchPayload = batch.map((email) => ({
      from: FROM_EMAIL,
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo,
      tags: email.tags,
    }));

    try {
      const client = getResendClient();
      const { data, error } = await client.batch.send(batchPayload);

      if (error) {
        console.error("[Email Batch] Error:", error);
        results.failed += batch.length;
      } else {
        results.successful += data?.data?.length || 0;
        results.failed += batch.length - (data?.data?.length || 0);
      }
    } catch (err) {
      console.error("[Email Batch] Exception:", err);
      results.failed += batch.length;
    }
  }

  return results;
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}
