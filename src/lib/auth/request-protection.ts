import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, ApiErrorCode } from "@/lib/api/response";

export class AuthProtectionError extends Error {
  constructor(message: string, public readonly status: 400 | 413 | 429 | 503) { super(message); }
}
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters")
  .max(72, "Password must fit within 72 UTF-8 bytes")
  .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must fit within 72 UTF-8 bytes");
export const emailSchema = z.string().trim().email("Invalid email address").max(254);
export const inviteCodeSchema = z.string().trim().min(1).max(64);
export const MAX_AUTH_BODY_BYTES = 16 * 1024;

export async function readAuthBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_AUTH_BODY_BYTES)) {
    throw new AuthProtectionError("Request is too large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_BODY_BYTES) {
        await reader.cancel();
        throw new AuthProtectionError("Request is too large", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function readAuthJson(request: Request): Promise<unknown> {
  try { return JSON.parse(Buffer.from(await readAuthBody(request)).toString("utf8")); }
  catch (error) {
    if (error instanceof AuthProtectionError) throw error;
    throw new AuthProtectionError("Invalid request body", 400);
  }
}

export function authProtectionResponse(error: unknown): Response | null {
  if (!(error instanceof AuthProtectionError)) return null;
  const code = error.status === 429 ? ApiErrorCode.RATE_LIMITED : error.status === 503 ? ApiErrorCode.INTERNAL_ERROR : ApiErrorCode.BAD_REQUEST;
  const response = apiError(code, error.message);
  return new Response(response.body, { status: error.status, headers: {
    "content-type": "application/json", "cache-control": "no-store",
    ...(error.status === 429 ? { "retry-after": "900" } : {}),
  } });
}

type HeadersInput = Headers | Record<string, string | string[] | undefined>;
export function trustedClientIdentity(headers?: HeadersInput): string {
  const name = process.env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER;
  // NextAuth does not expose a trustworthy socket address. The default is a shared
  // source bucket. Forwarded headers are ignored without an explicit proxy contract.
  if (!name) return "shared-source";
  if (!/^[a-z0-9-]+$/.test(name) || ["forwarded", "x-forwarded-for"].includes(name)) {
    throw new AuthProtectionError("Authentication protection is unavailable", 503);
  }
  const value = headers instanceof Headers ? headers.get(name) : headers?.[name];
  if (typeof value !== "string" || !isIP(value)) throw new AuthProtectionError("Authentication protection is unavailable", 503);
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const [left, right = ""] = canonical.split("::");
  const head = left ? left.split(":") : [], tail = right ? right.split(":") : [];
  const groups = canonical.includes("::") ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  return groups.slice(0, 4).map(part => parseInt(part, 16).toString(16)).join(":") + "::/64";
}

export function authRateKey(scope: string, identity: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AuthProtectionError("Authentication protection is unavailable", 503);
  return createHmac("sha256", secret).update(JSON.stringify(["auth-v1", scope, identity])).digest("hex");
}

type Bucket = { scope: string; identity: string; limit: number; windowSeconds?: number };
/** Every attempted operation consumes durable allowance before password work or delivery. */
export async function consumeAuthLimits(buckets: Bucket[]): Promise<void> {
  const keys = buckets.map(bucket => ({ ...bucket, key: authRateKey(bucket.scope, bucket.identity) })).sort((a, b) => a.key.localeCompare(b.key));
  let admitted: boolean;
  try {
    // Opportunistic bounded cleanup keeps expired attacker-chosen identities from
    // accumulating. Skip locked rows so concurrent admissions remain independent.
    await prisma.$executeRaw`WITH expired AS (
      SELECT "key" FROM "auth_rate_limits" WHERE "expiresAt" <= CURRENT_TIMESTAMP
      ORDER BY "expiresAt" LIMIT 256 FOR UPDATE SKIP LOCKED
    ) DELETE FROM "auth_rate_limits" WHERE "key" IN (SELECT "key" FROM expired)`;
    admitted = await prisma.$transaction(async tx => {
      let allowed = true;
      for (const bucket of keys) {
        const seconds = bucket.windowSeconds ?? 900;
        const rows = await tx.$queryRaw<Array<{ count: number }>>`
          INSERT INTO "auth_rate_limits" ("key", "count", "expiresAt")
          VALUES (${bucket.key}, 1, CURRENT_TIMESTAMP + ${seconds} * INTERVAL '1 second')
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE WHEN "auth_rate_limits"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "auth_rate_limits"."count" + 1 END,
            "expiresAt" = CASE WHEN "auth_rate_limits"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + ${seconds} * INTERVAL '1 second' ELSE "auth_rate_limits"."expiresAt" END
          WHERE "auth_rate_limits"."count" < ${bucket.limit} OR "auth_rate_limits"."expiresAt" <= CURRENT_TIMESTAMP
          RETURNING "count"`;
        if (rows.length !== 1) allowed = false;
      }
      return allowed;
    });
  } catch { throw new AuthProtectionError("Authentication protection is unavailable. Try again later.", 503); }
  if (!admitted) throw new AuthProtectionError("Too many requests. Try again in 15 minutes.", 429);
}

export async function protectAuthRequest(action: string, headers?: HeadersInput, identity?: string): Promise<void> {
  await consumeAuthLimits([
    { scope: `${action}:global`, identity: "global", limit: 1000 },
    { scope: `${action}:source`, identity: trustedClientIdentity(headers), limit: 100 },
    ...(identity ? [{ scope: `${action}:account`, identity: identity.toLowerCase().trim(), limit: action === "sign-in" ? 10 : 5 }] : []),
  ]);
}

export async function protectAccountEmail(purpose: "reset" | "verification" | "invitation", email: string, organizationId?: string): Promise<void> {
  await consumeAuthLimits([
    { scope: "email:global", identity: "global", limit: 500, windowSeconds: 3600 },
    { scope: `email:${purpose}:recipient`, identity: email.toLowerCase().trim(), limit: 3 },
    ...(organizationId ? [{ scope: "email:organization", identity: organizationId, limit: 100 }] : []),
  ]);
}
