-- Add conversation_type column to chat_conversations
-- Supports: 'table' (existing table generation) and 'qa' (new Q&A mode)

ALTER TABLE chat_conversations
  ADD COLUMN conversation_type text NOT NULL DEFAULT 'table';

COMMENT ON COLUMN chat_conversations.conversation_type IS '''table'' | ''qa'' — 서비스 유형';
