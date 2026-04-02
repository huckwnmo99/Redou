# Chat/Table 생성 파이프라인 감사 보고서

> 작성일: 2026-04-01
> 대상: `main.mjs` (Stage 1-4), `llm-orchestrator.mjs`, `llm-chat.mjs`, `html-table-parser.mjs`

---

## 수정 방향: 전략 B

코드 어셈블러(Stage 3b-3c)를 보조로 격하하고, Table Agent(LLM)를 주력으로 전환한다.
코드 파서로 OCR HTML을 파싱한 뒤, 매핑/조립은 LLM에게 위임.
파싱된 매트릭스 + 텍스트 청크를 RAG 컨텍스트로 넘겨 Table Agent가 직접 추출.

---

## P1 — 핵심 문제 (빈 테이블/1개 논문 원인)

### P1-1. 참조번호가 잘못된 셀에 삽입됨
- **위치**: `main.mjs:3094-3098`
- **코드**:
  ```js
  if (cellValue && !refAdded && /\d/.test(cellValue)) {
    cellValue = `${cellValue} [${globalRefNo}]`;
  ```
- **문제**: "zeolite 13X" 같은 식별자에 숫자가 포함되어 있으면 참조번호가 흡착제 이름에 붙음.
- **영향**: 참조 추적 불가, 테이블 가독성 저하.
- **수정**: 전략 B에서 Table Agent가 참조번호를 직접 배치하므로 코드 삽입 로직 제거.

### P1-2. context_fields 매칭이 하드코딩으로 제한적
- **위치**: `main.mjs:3076-3088`
- **코드**:
  ```js
  if (specLower.includes("adsorbent") || specLower.includes("material") || specLower.includes("흡착")) {
    cellValue = ctx.adsorbent || "";
  }
  ```
- **문제**: Mapper가 `ctx.adsorbent = "zeolite 13X"`를 제공해도, 컬럼 이름이 "Sorbent", "Target gas" 등이면 매칭 실패 → 빈 셀 → N/A.
- **영향**: 대부분의 식별 컬럼이 비게 됨 → P1-3과 결합하여 행 전체 삭제.
- **수정**: 전략 B에서 코드 어셈블러 자체를 사용하지 않으므로 해소.

### P1-3. N/A 필터링이 너무 공격적
- **위치**: `main.mjs:3104-3106`
- **코드**:
  ```js
  if (!hasData || naCount > outRow.length / 2) continue;
  ```
- **문제**: 7개 컬럼 중 3개만 데이터가 있는 논문 → 4/7 = 57% N/A → 행 전체 삭제. 논문마다 보고하는 파라미터가 달라 정상 데이터도 필터링됨.
- **영향**: 결과 테이블 0행 (모든 행이 삭제됨).
- **수정**: 전략 B에서 LLM이 직접 판단하므로 코드 필터 불필요.

### P1-4. column_map 길이 ≠ headers 길이 검증 없음
- **위치**: `main.mjs:3070`
- **문제**: Mapper가 일부 컬럼을 누락/추가 시 `outRow.length ≠ mergedHeaders.length` → 테이블 구조 붕괴.
- **수정**: 전략 B에서 코드 어셈블러 제거 시 해소.

### P1-5. context_fields 스키마가 5개 필드로 제한
- **위치**: `llm-orchestrator.mjs:424-432`
- **코드**:
  ```js
  context_fields: {
    properties: {
      adsorbent, gas, temperature, pressure, method  // 이 5개만 가능
    }
  }
  ```
- **문제**: pH, concentration, catalyst loading 등 다른 컨텍스트 값 전달 불가 → N/A 증가.
- **수정**: 전략 B에서 Mapper Agent 자체를 사용하지 않으므로 해소.

---

## P2 — 중요 문제 (파이프라인 안정성)

### P2-1. LLM JSON.parse 에러 처리 없음
- **위치**: `llm-orchestrator.mjs:265, 336, 396` + `llm-chat.mjs:156`
- **코드**:
  ```js
  const plan = JSON.parse(json.message.content);  // try/catch 없음
  ```
- **문제**: Ollama가 잘린/비정상 JSON 반환 시 전체 파이프라인 크래시.
- **수정**: 모든 `JSON.parse` 호출에 try/catch + 재시도 또는 에러 메시지 반환.

### P2-2. OCR 테이블에 용량 제한 없음
- **위치**: `main.mjs:2704` (`assembleRagContext`)
- **코드**: `// OCR tables get unlimited space`
- **문제**: 6개 논문 × 평균 5개 테이블 = 30+ HTML 테이블이 모두 컨텍스트에 포함 → 131K 토큰 초과 가능.
- **수정**: OCR 테이블에도 글자 수 상한(예: 60K chars) 설정. 논문당 가장 관련 높은 테이블 우선.

### P2-3. assembleRagContext 3번 중복 호출
- **위치**: `main.mjs:2897, 2995, 3118`
- **문제**: 동일 결과를 3번 계산. 변수 섀도잉(`const ragContext` 2번 선언)으로 유지보수 혼란.
- **수정**: 한 번만 호출하고 재사용.

### P2-4. Supabase RPC 에러 조용히 무시
- **위치**: `main.mjs:2647, 2661, 2870`
- **코드**:
  ```js
  const { data: chunks } = await supabase.rpc("match_chunks", ...);
  // data가 null이면 에러인데 [] 로 처리, 로그 없음
  ```
- **문제**: 임베딩 누락, 인덱스 손상 등으로 RPC 실패 시 무응답.
- **수정**: `error` 필드 체크 + 경고 로그.

### P2-5. Guardian 검증 — 셀마다 순차 LLM 호출
- **위치**: `main.mjs:3207-3217`
- **문제**: 50행 × 5열 = 250번 순차 Granite Guardian 호출 → 수십 분 소요.
- **수정**: 배치 병렬화 (Promise.all 5~10개씩) + 최대 검증 셀 수 제한.

### P2-6. include_rows 0-based/1-based 모호
- **위치**: `main.mjs:3063`
- **코드**:
  ```js
  if (includeSet && !includeSet.has(ri) && !includeSet.has(ri + 1)) continue;
  ```
- **문제**: 0-based와 1-based를 동시에 허용 → 불필요한 행 포함 가능.
- **수정**: 전략 B에서 코드 어셈블러 제거 시 해소.

---

## P3 — 경미한 문제 (설계/유지보수)

### P3-1. Dead code — llm-chat.mjs의 미사용 함수
- **위치**: `llm-chat.mjs:169` (`buildClarificationPrompt`), `llm-chat.mjs:191` (`buildGenerationPrompt`)
- **문제**: 현재 파이프라인에서 미사용. 혼란 유발.
- **수정**: 제거.

### P3-2. modify_table이 이전 데이터 없이 재생성
- **위치**: `main.mjs:2787-2793`
- **문제**: Orchestrator에 이전 테이블의 title/headers/row count만 전달. 실제 데이터 없음 → 수정이 아닌 재생성.
- **수정**: 이전 테이블 데이터도 컨텍스트로 전달 (후순위).

### P3-3. Orchestrator가 항상 clarify부터 함
- **위치**: `llm-orchestrator.mjs:88`
- **코드**: `**첫 번째 메시지에서는 반드시 clarify를 선택하세요.**`
- **문제**: 구체적 요청이어도 무조건 질문부터 → 불필요한 라운드트립.
- **수정**: 프롬프트 완화 — "정보가 부족할 때만 clarify" (후순위).

### P3-4. Ollama fetch에 타임아웃 없음
- **위치**: `llm-orchestrator.mjs` 및 `llm-chat.mjs`의 모든 fetch 호출
- **문제**: Ollama 행 시 무한 대기. 유저 abort만 탈출 가능.
- **수정**: `AbortSignal.timeout(300000)` 등 설정 (후순위).

### P3-5. Guardian combined source 8000자 제한
- **위치**: `main.mjs:3204`
- **문제**: 관련 소스가 잘릴 수 있어 정당한 셀도 "unverified"로 판정.
- **수정**: 셀별로 해당 논문의 소스만 필터링하여 전달 (후순위).

### P3-6. HTML 파서 — 중첩 테이블 미지원
- **위치**: `html-table-parser.mjs:301`
- **코드**: `/<table[^>]*>[\s\S]*?<\/table>/gi` (lazy matching)
- **문제**: 중첩 `<table>` 시 내부 `</table>`에서 잘림.
- **수정**: 중첩 깊이 추적 또는 DOM 파서 사용 (후순위).

---

## 전략 B 구현 시 변경 범위

| 단계 | 현재 | 변경 후 |
|------|------|---------|
| Stage 1 (Orchestrator) | 유지 | 유지 |
| Stage 2 (RAG) | 유지 | 유지 + 백필 유지 |
| Stage 3a (Parse) | 코드 파서 + LLM 폴백 | 유지 (파싱 결과를 컨텍스트로 활용) |
| Stage 3b (Mapper) | Mapper Agent LLM 호출 | **제거** |
| Stage 3c (Assembler) | 코드 기반 조립 | **제거** → Table Agent가 대체 |
| Table Agent | 폴백으로만 사용 | **주력** — 파싱된 매트릭스 포함 컨텍스트 |
| Stage 4 (Guardian) | 유지 | 유지 + P2-5 병렬화 |

### 해소되는 이슈
- P1-1, P1-2, P1-3, P1-4, P1-5, P2-6 → 코드 어셈블러/매퍼 제거로 자동 해소

### 별도 수정 필요
- P2-1 (JSON.parse 에러 처리)
- P2-2 (OCR 컨텍스트 용량 제한)
- P2-3 (중복 호출 제거)
- P2-4 (RPC 에러 로깅)
- P2-5 (Guardian 병렬화)
