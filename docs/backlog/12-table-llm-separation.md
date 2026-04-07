# 테이블 생성 / 논문 Q&A 서비스 분리

> 상태: 💡 아이디어 | 등록일: 2026-04-06

## 배경
현재 `llm-chat.mjs`와 `llm-orchestrator.mjs`가 채팅, 테이블 생성, 검증을 모두 처리.
용도가 다른 두 서비스가 섞여 있어 각각 최적화하기 어려움.

## 핵심 아이디어
두 서비스를 분리한다:

### A. 테이블 생성 서비스
- 논문 데이터를 비교 테이블로 구조화
- RAG로 관련 청크 수집 → 테이블 스펙 기반 데이터 추출
- JSON 출력 안정성이 핵심 (구조화된 출력)

### B. 논문 Q&A 서비스
- "이런 데이터가 있는 논문이 있어?", "PSA 관련 논문 찾아줘" 등
- 자연어 질의응답, 스트리밍 응답
- 출처 귀속(attribution)이 핵심

## 현재 코드 구조
- `llm-chat.mjs` — streamChat(), checkGroundedness(), isLlmAvailable()
- `llm-orchestrator.mjs` — generateOrchestratorPlan(), generateTableFromSpec(), extractMatrixFromHtml()
- `chat_conversations`, `chat_messages`, `chat_generated_tables` 테이블

## 예상 영향
- Electron: 모듈 분리/리팩토링
- IPC: 채널 분리 (테이블용 / Q&A용)
- Frontend: ChatView 분리 또는 모드 전환
- DB: 기존 테이블 유지 가능, 새 테이블 필요 여부 검토

## 결정 사항
- 같은 LLM 모델 사용, 프롬프트와 검증 방식만 분리
- Frontend UI 분리 여부는 /plan 단계에서 결정

## 열린 질문
- [ ] Frontend에서 UI를 완전 분리할 것인지, 같은 화면에서 모드 전환할 것인지?
