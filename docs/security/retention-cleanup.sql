-- Review and authorize this destructive cleanup before using it in an intended environment.
-- No cleanup in this file was executed against real application data in the assessment.
-- First inventory counts and reconcile retention/backup obligations with the operator.
SELECT count(*) AS usage_rows_with_content FROM ai_usage_logs
WHERE "requestSummary" IS NOT NULL OR "responseSummary" IS NOT NULL
   OR ("errorMessage" IS NOT NULL AND "errorMessage" <> 'generation_failed');
SELECT count(*) AS deleted_conversation_messages FROM ai_messages
WHERE "conversationId" IN (SELECT id FROM ai_conversations WHERE status = 'DELETED');
SELECT count(*) AS unbound_partnership_cache_rows FROM partnership_reasonings
WHERE "inputFingerprint" IS NULL;

-- Deliberately commented: uncomment only after approval of the inventory and target.
-- BEGIN;
-- UPDATE ai_usage_logs SET "requestSummary" = NULL, "responseSummary" = NULL,
--   "errorMessage" = CASE WHEN success THEN NULL ELSE 'generation_failed' END;
-- DELETE FROM ai_messages WHERE "conversationId" IN
--   (SELECT id FROM ai_conversations WHERE status = 'DELETED');
-- UPDATE ai_conversations SET title = 'Deleted conversation' WHERE status = 'DELETED';
-- DELETE FROM partnership_reasonings WHERE "inputFingerprint" IS NULL;
-- COMMIT;
