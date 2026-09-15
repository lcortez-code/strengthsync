ALTER TABLE "email_digest_logs" ADD COLUMN "organizationId" TEXT,
 ADD COLUMN "memberId" TEXT, ADD COLUMN "deliveryKey" TEXT;
CREATE UNIQUE INDEX "email_digest_logs_deliveryKey_key" ON "email_digest_logs"("deliveryKey");
ALTER TYPE "EmailStatus" ADD VALUE 'SKIPPED';
