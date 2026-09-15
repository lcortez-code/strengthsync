-- Preserve legacy access without falsely claiming ownership of existing addresses.
ALTER TABLE "users" ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ALTER COLUMN "emailVerificationRequired" SET DEFAULT true;
ALTER TABLE "users" ADD COLUMN "emailVerifyExpires" TIMESTAMP(3);
-- Legacy plaintext verification tokens have never had a supported consumption flow.
UPDATE "users" SET "emailVerifyToken" = NULL;
CREATE TABLE "auth_rate_limits" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "auth_rate_limits_expiresAt_idx" ON "auth_rate_limits"("expiresAt");
