-- Add LLM model preference column to user_workspace_preferences
ALTER TABLE user_workspace_preferences
  ADD COLUMN IF NOT EXISTS llm_model text;

COMMENT ON COLUMN user_workspace_preferences.llm_model IS '사용자 선택 LLM 모델명 (Ollama). NULL이면 환경변수 또는 기본값 사용';
