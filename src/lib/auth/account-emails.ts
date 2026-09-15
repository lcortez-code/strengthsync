import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendEmail, isEmailConfigured } from "@/lib/email/resend";
import { protectAccountEmail } from "@/lib/auth/request-protection";
import { escapeHtml } from "@/lib/email/html";

const invitationSchema = z.object({
  purpose: z.literal("organization-invitation"),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER"]),
  version: z.string().datetime(),
  expiresAt: z.number().int().positive(),
});
export type InvitationClaims = z.infer<typeof invitationSchema>;
type InvitedMember = { id: string; userId: string; organizationId: string; role: string; updatedAt: Date };

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Account email signing is not configured");
  return secret;
}

function accountUrl(path: string, token: string): string {
  if (!process.env.NEXTAUTH_URL) throw new Error("Account email URL is not configured");
  const url = new URL(process.env.NEXTAUTH_URL);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("Account email URL must use HTTPS");
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", token);
  return url.toString();
}

export function requireAccountEmail(): void {
  if (!isEmailConfigured()) throw new Error("Email service is not configured");
  accountUrl("/auth/reset-password", "configuration-check");
}

export function requireInvitationEmail(): void {
  requireAccountEmail();
  signingSecret();
}

export function createInvitationToken(member: InvitedMember, now = Date.now()): string {
  const claims = invitationSchema.parse({
    purpose: "organization-invitation", userId: member.userId,
    organizationId: member.organizationId, memberId: member.id, role: member.role,
    version: member.updatedAt.toISOString(), expiresAt: now + 7 * 24 * 60 * 60 * 1000,
  });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function readInvitationToken(token: string, now = Date.now()): InvitationClaims | null {
  if (token.length > 4096) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  try {
    const expected = createHmac("sha256", signingSecret()).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = invitationSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success && parsed.data.expiresAt > now ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function sendOrganizationInvitation(member: InvitedMember, email: string, organizationName: string): Promise<void> {
  requireAccountEmail();
  await protectAccountEmail("invitation", email, member.organizationId);
  const url = accountUrl("/auth/invitation", createInvitationToken(member));
  const result = await sendEmail({
    to: email,
    subject: "You are invited to join an organization on StrengthSync",
    html: "<p>You have been invited to join <strong>" + escapeHtml(organizationName) + "</strong> as " + escapeHtml(member.role.toLowerCase()) + '.</p><p>Sign in with this email address and accept the invitation to join. This link expires in 7 days.</p><p><a href="' + escapeHtml(url) + '">Review invitation</a></p><p>If you do not want to join, ignore this email.</p>',
    text: "You have been invited to join " + organizationName + " as " + member.role.toLowerCase() + ". Sign in with this email address and accept: " + url + "\nThis invitation expires in 7 days. If you do not want to join, ignore this email.",
    tags: [{ name: "type", value: "organization-invitation" }],
  });
  if (!result.success) throw new Error("Invitation email could not be sent");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ResetEmailCooldownError extends Error {}

/** Replaces outstanding reset tokens, but never changes the password before acceptance. */
export async function sendPasswordReset(user: { id: string; email: string; fullName: string }): Promise<void> {
  requireAccountEmail();
  await protectAccountEmail("reset", user.email);
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const url = accountUrl("/auth/reset-password", token);
  // The existing expiry also records issuance time (expiry minus one hour).
  // Use a conditional write so concurrent requests cannot send repeated reset emails.
  const issued = await prisma.user.updateMany({
    where: { id: user.id, OR: [
      { passwordResetToken: null }, { passwordResetExpires: null },
      { passwordResetExpires: { lte: new Date(Date.now() + 55 * 60 * 1000) } },
    ] },
    data: { passwordResetToken: tokenHash, passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  if (issued.count !== 1) throw new ResetEmailCooldownError("A reset email was requested recently. Wait five minutes before requesting another.");
  try {
    const result = await sendEmail({
      to: user.email,
      subject: "Reset Your Password - StrengthSync",
      html: "<p>Hi " + escapeHtml(user.fullName) + ',</p><p>A password reset was requested for your account. Your password will change only after you use this link.</p><p><a href="' + escapeHtml(url) + '">Reset password</a></p><p>This single-use link expires in one hour. If you did not request a reset, you can ignore this email.</p>',
      text: "Hi " + user.fullName + ",\nA password reset was requested for your account. Reset your password: " + url + "\nThis single-use link expires in one hour. Your password will change only after you use it. If you did not request a reset, ignore this email.",
      tags: [{ name: "type", value: "password-reset" }],
    });
    if (!result.success) throw new Error("Password reset email could not be sent");
  } catch {
    // Do not clear a newer request that may have been issued concurrently.
    await prisma.user.updateMany({
      where: { id: user.id, passwordResetToken: tokenHash },
      data: { passwordResetToken: null, passwordResetExpires: null },
    });
    throw new Error("Password reset email could not be sent");
  }
}

export class VerificationEmailCooldownError extends Error {}

/** An unverified recipient always chooses a fresh password, preventing preregistration takeover. */
export async function sendEmailVerification(
  user: { id: string; email: string; fullName: string },
  invitation?: { member: InvitedMember; organizationName: string },
): Promise<void> {
  requireInvitationEmail();
  await protectAccountEmail("verification", user.email, invitation?.member.organizationId);
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const url = new URL(accountUrl("/auth/verify-email", token));
  if (invitation) url.searchParams.set("invitation", createInvitationToken(invitation.member));
  const issued = await prisma.user.updateMany({
    where: { id: user.id, email: user.email, emailVerified: false, OR: [
      { emailVerifyToken: null }, { emailVerifyExpires: null },
      { emailVerifyExpires: { lte: new Date(Date.now() + 55 * 60 * 1000) } },
    ] },
    data: { emailVerifyToken: tokenHash, emailVerifyExpires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  if (issued.count !== 1) throw new VerificationEmailCooldownError("A verification email was requested recently. Wait five minutes before requesting another.");
  const context = invitation ? ` You are invited to join ${invitation.organizationName} as ${invitation.member.role.toLowerCase()}.` : "";
  try {
    const result = await sendEmail({
      to: user.email, subject: "Verify your email and set your password - StrengthSync",
      html: `<p>Hi ${escapeHtml(user.fullName)},</p><p>Verify your email address and choose your own password to finish setting up your account.${escapeHtml(context)}</p><p><a href="${escapeHtml(url.toString())}">${invitation ? "Review invitation and set password" : "Verify email and set password"}</a></p><p>This single-use link expires in one hour. If you did not request this account or do not want to join, ignore this email.</p>`,
      text: `Hi ${user.fullName},\nVerify your email and choose your own password to finish account setup.${context}\n${url}\nThis single-use link expires in one hour. If you do not want this account or invitation, ignore this email.`,
      tags: [{ name: "type", value: "email-verification" }],
    });
    if (!result.success) throw new Error("Verification delivery failed");
  } catch {
    await prisma.user.updateMany({ where: { id: user.id, emailVerifyToken: tokenHash }, data: { emailVerifyToken: null, emailVerifyExpires: null } });
    throw new Error("Verification email could not be sent");
  }
}

export async function sendMemberInvitation(member: InvitedMember & {
  user: { id: string; email: string; fullName: string; emailVerified?: boolean; emailVerificationRequired?: boolean };
  organization: { name: string };
}): Promise<void> {
  if (member.user.emailVerificationRequired && !member.user.emailVerified) {
    await sendEmailVerification(member.user, { member, organizationName: member.organization.name });
  } else {
    await sendOrganizationInvitation(member, member.user.email, member.organization.name);
  }
}
