# Gemma 4 31B 모델 전환

> 상태: 💡 아이디어 | 등록일: 2026-04-06

## 배경
현재 `gpt-oss:120b` 사용 중. Gemma 4 31B Dense가 Arena AI 3위 달성하면서 더 작은 모델로 동등 이상 성능 가능.

## 핵심 아이디어
- `gpt-oss:120b` → `gemma4:31b`로 전환
- VRAM ~20GB, 컨텍스트 256K
- Apache 2.0 라이선스

## 예상 영향
- `llm-chat.mjs`: `LLM_MODEL` 기본값 변경
- `llm-orchestrator.mjs`: `LLM_MODEL` 기본값 변경
- 프롬프트 포맷 호환성 확인 필요 (Gemma 4는 system role 네이티브 지원)
- Guardian 모델도 전환 검토 (`granite3-guardian:8b` → 대안?)

## 선행 조건
- Ollama 업데이트 필요 (현재 0.18.2 → Gemma 4 지원 버전)

## 주의사항
- 프롬프트 품질 비교 테스트 필요 (기존 gpt-oss vs gemma4)
- JSON 출력 안정성 확인 (llm-orchestrator가 JSON 파싱에 의존)
