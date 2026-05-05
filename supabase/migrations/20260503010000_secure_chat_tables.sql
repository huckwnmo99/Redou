-- Secure chat tables added after the original all-table RLS migration.

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_generated_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_conversations_all_own" ON chat_conversations;
CREATE POLICY "chat_conversations_all_own" ON chat_conversations
  FOR ALL USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "chat_messages_all_via_conversation" ON chat_messages;
CREATE POLICY "chat_messages_all_via_conversation" ON chat_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = chat_messages.conversation_id
        AND chat_conversations.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = chat_messages.conversation_id
        AND chat_conversations.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_generated_tables_all_via_conversation" ON chat_generated_tables;
CREATE POLICY "chat_generated_tables_all_via_conversation" ON chat_generated_tables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = chat_generated_tables.conversation_id
        AND chat_conversations.owner_user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM chat_messages
      WHERE chat_messages.id = chat_generated_tables.message_id
        AND chat_messages.conversation_id = chat_generated_tables.conversation_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = chat_generated_tables.conversation_id
        AND chat_conversations.owner_user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM chat_messages
      WHERE chat_messages.id = chat_generated_tables.message_id
        AND chat_messages.conversation_id = chat_generated_tables.conversation_id
    )
  );
