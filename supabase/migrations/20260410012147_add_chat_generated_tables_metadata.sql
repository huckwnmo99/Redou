-- SRAG 스타일 2단계 추출 지원: chat_generated_tables에 metadata JSONB 컬럼 추가
-- nullSummary (Step 4 Agentic 재검색용 자료), 추출 모드, per-paper 타이밍 등을 저장

ALTER TABLE chat_generated_tables
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN chat_generated_tables.metadata IS
  'SRAG extraction metadata: { extractionMode: "per_paper" | "single_call_fallback", nullSummary: { totalNulls, details: [{paperId, paperTitle, column, rowIndex}] }, perPaperTiming: [{paperId, ms}], partialFailures: [{paperId, error}] }';
