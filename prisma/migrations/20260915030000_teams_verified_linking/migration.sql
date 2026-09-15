ALTER TABLE "teams_user_mappings"
  ADD COLUMN "teamsTenantId" TEXT,
  ADD COLUMN "teamsDisplayName" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE TABLE "teams_link_challenges" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "teamsTenantId" TEXT NOT NULL,
  "teamsUserId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teams_link_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teams_link_challenges_tokenHash_key" ON "teams_link_challenges"("tokenHash");
CREATE UNIQUE INDEX "teams_link_challenges_teamsTenantId_teamsUserId_key" ON "teams_link_challenges"("teamsTenantId", "teamsUserId");
CREATE INDEX "teams_link_challenges_expiresAt_idx" ON "teams_link_challenges"("expiresAt");
