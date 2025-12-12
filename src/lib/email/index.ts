/**
 * Email Module
 * Provides email sending capabilities using Resend
 */

// Core email functionality
export {
  sendEmail,
  sendBatchEmails,
  isEmailConfigured,
  type SendEmailOptions,
  type EmailResult,
} from "./resend";

// Digest service
export {
  getDigestRecipients,
  getUserDigestData,
  wasDigestSent,
  getWeeklyDigestPeriod,
} from "./digest-service";

// Email templates
export {
  generateWeeklyDigestHtml,
  generateWeeklyDigestText,
  type WeeklyDigestData,
} from "./templates/weekly-digest";
