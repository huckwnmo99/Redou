-- Chat feature: conversation + messages + generated tables
-- LLM-based research data comparison table generation

-- ============================================================
-- 1. chat_conversations
-- ============================================================
CREATE TABLE chat_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL,
  title           text NOT NULL DEFAULT 'New Chat',
  phase           text NOT NULL DEFAULT 'clarifying',  -- 'clarifying' | 'follow_up'
  scope_folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  scope_all       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. chat_messages
-- ============================================================
CREATE TABLE chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role             text NOT NULL,                          -- 'user' | 'assistant'
  content          text NOT NULL,
  message_type     text NOT NULL DEFAULT 'text',           -- 'text' | 'table_report' | 'error'
  metadata         jsonb,                                  -- source_chunk_ids, referenced_paper_ids
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, created_at);

-- ============================================================
-- 3. chat_generated_tables
-- ============================================================
CREATE TABLE chat_generated_tables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  table_title      text,
  headers          jsonb NOT NULL,                         -- ["Material", "Temp", "Capacity", "Ref"]
  rows             jsonb NOT NULL,                         -- [["Zeolite 5A", "25°C", "3.2 [1]"], ...]
  source_refs      jsonb,                                  -- [{refNo, paperId, title, authors, year}]
  verification     jsonb,                                  -- [{row, col, status, details}] — async fill
  created_at       timestamptz NOT NULL DEFAULT now()
);
