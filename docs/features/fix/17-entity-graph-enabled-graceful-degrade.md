# Fix: getEntityGraphEnabled DB 조회 에러 시 graceful degrade (graph OFF)

> 유형: fix | 작성일: 2026-05-29 | 대상 브랜치: `codex/rag-infra-extraction`

## 문제

- **증상**: `entity_graph_enabled` 컬럼이 없는 DB(마이그레이션 `20260527073618_add_entity_graph_enabled.sql` 미적용 환경 — fresh/CI/롤백)에서 **QA 파이프라인 전체가 깨진다.** dev DB에는 컬럼이 적용되어 현재는 재현되지 않지만, 미적용 환경 방어가 목적이다.
- **원인**: `getEntityGraphEnabled(userId)` 헬퍼가 Supabase 조회 에러 시 `throw new Error(error.message)` 한다. 이 헬퍼는 **QA마다 무조건 호출**되므로(`handleQaPipeline`), 컬럼 부재 시 PostgREST가 반환하는 에러가 throw로 전파되어 QA 응답 생성 자체를 중단시킨다.
- **근거**:
  - `apps/desktop/electron/main.mjs:488-497` — 헬퍼 정의. 문제 지점은 `:495`의 `if (error) throw new Error(error.message);`
    ```js
    async function getEntityGraphEnabled(userId = null) {
      if (!userId) return false; // 비로그인/시스템 컨텍스트 → 기본 OFF
      const { data: pref, error } = await supabase
        .from("user_workspace_preferences")
        .select("entity_graph_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);   // ← 문제 지점 (line 495)
      return pref?.entity_graph_enabled === true; // null/미설정 → false
    }
    ```
  - `apps/desktop/electron/main.mjs:2451` — `handleQaPipeline`에서 `const graphEnabled = await getEntityGraphEnabled(ownerId);` 직접 호출(try/catch 밖). 여기서 throw되면 QA 전체 실패. **이 호출부가 핵심 영향 지점.**
  - `apps/desktop/electron/main.mjs:1152` — `enqueueEntityExtractionIfNeeded`의 진입 게이트(`if (!(await getEntityGraphEnabled(userId)))`). 단, 이 함수는 전체가 `try { ... }`로 감싸져 있음(`:1149`)이라 throw돼도 자동 큐잉만 스킵되고 core import는 안전.
  - `apps/desktop/electron/main.mjs:2931` — `ENTITY_GET_GRAPH_ENABLED` IPC 핸들러. 이미 try/catch로 감쌈(`:2929`)이라 throw 시 토글 UI가 `{ success: false }`만 받음.

## 판단 사항 (작업 지시의 의사결정 항목)

작업 지시에서 명시적으로 요청한 3가지 판단을 코드 근거와 함께 정리한다.

### (1) `return false` 단순 처리 vs `console.warn` 후 false — **권장: console.warn 후 false**

- 작업 지시는 "다른 graceful 헬퍼 패턴과 일관 — getEntityExtractionModel 확인"을 요청했으나, 확인 결과 **인접 헬퍼는 graceful하지 않다.**
  - `getEntityExtractionModel`(`:483`), `applyUserLlmPreference`(`:467`) 모두 동일하게 `if (error) throw new Error(error.message)`. 이들은 graceful degrade 대상이 아니라 throw 패턴이다. → **이 둘과 일관시키면 throw 유지가 되어버려 목적(graceful degrade)과 모순.** 따라서 이 헬퍼들은 일관성 기준으로 부적절.
- 대신 이 코드베이스의 **확립된 graceful degradation 패턴은 GROBID degraded-mode**다:
  - `main.mjs:899` — `console.warn("[pipeline] GROBID unavailable — proceeding with MinerU-only metadata (degraded mode)")`
  - `main.mjs:1029` — `console.warn("[process] GROBID unavailable — proceeding in degraded mode ...")`
  - 즉 "서비스/리소스 부재 → `console.warn`로 1회 가시화 → degrade하여 계속 진행"이 이 코드베이스의 graceful 선례다.
- **결론**: `console.warn`로 1회 로깅 후 `false` 반환이 GROBID degraded-mode 패턴과 일관된다. 무음 `return false`는 마이그레이션 미적용/일시 DB 장애를 진단 불가능하게 만들므로 비권장. 단, 로그 메시지는 PII(userId) 노출을 피하고 prefix를 통일한다(`[entity-graph]`).

### (2) PostgREST 컬럼 부재 코드와 일시적 DB 에러 구분 필요성 — **불필요 (모든 에러에 false)**

- 코드베이스 전체에 PostgREST 에러코드 분기 선례가 **0건**이다 (`error.code` / `42703`(undefined_column) / `42P01`(undefined_table) / `PGRST` 패턴 검색 결과 main.mjs 내 없음).
- graceful degrade의 목적상, 컬럼 부재든 일시적 DB 에러든 **결과는 동일하게 "graph OFF로 안전하게 진행"이 옳다.** 일시적 DB 에러를 따로 throw로 구분해봤자 QA가 깨지는 결과는 똑같고, 일시 장애는 다음 호출에서 자연 복구된다.
- **결론**: 에러코드 분기는 과설계. 모든 에러에 대해 `false`가 적절하다. (로그 메시지에 `error.message`를 포함시키면 컬럼 부재/일시 장애를 사후에 구분 가능 — 코드 분기 없이 진단성 확보.)

### (3) QA 호출부(2451) 추가 변경 필요성 — **불필요**

- `main.mjs:2451-2473` 확인 결과: `graphEnabled`가 falsy면 `else` 분기에서 `runMultiQueryRag(...)`(plain RAG, pre-graph 동작)로 진행한다. 헬퍼가 false만 주면 호출부는 의도대로 plain RAG로 graceful degrade한다.
- 따라서 헬퍼 한 곳만 고치면 QA 경로는 자동으로 정상화된다. **호출부 변경 불필요.**
- 부수 효과(의도된 개선): `ENTITY_GET_GRAPH_ENABLED` IPC(`:2931`)도 헬퍼가 false를 주면 `{ success: true, data: { enabled: false } }`를 반환 → 컬럼 부재 환경에서 Settings 토글이 에러 대신 "OFF"로 정상 표시됨.

## 수정 방안

| 파일 | 수정 내용 |
|------|-----------|
| `apps/desktop/electron/main.mjs` (`:495`) | `getEntityGraphEnabled` 내부의 `if (error) throw new Error(error.message);` 한 줄을, `console.warn`로 1회 로깅 후 `return false;`로 교체. throw 제거. |

수정 후 헬퍼 형태(초안):
```js
async function getEntityGraphEnabled(userId = null) {
  if (!userId) return false; // 비로그인/시스템 컨텍스트 → 기본 OFF
  const { data: pref, error } = await supabase
    .from("user_workspace_preferences")
    .select("entity_graph_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // graph는 opt-in 부가 기능. 컬럼 부재(마이그레이션 미적용)/일시 DB 에러 시
    // throw 대신 OFF로 graceful degrade → QA는 plain RAG로 진행. (GROBID degraded-mode 패턴과 일관)
    console.warn(`[entity-graph] preference lookup failed, defaulting to OFF: ${error.message}`);
    return false;
  }
  return pref?.entity_graph_enabled === true; // null/미설정 → false
}
```

> 구현 메모(에이전트용): `console.warn` 메시지에 `userId`를 넣지 말 것(PII). `error.message`만 포함해 컬럼 부재/일시 장애를 사후 구분 가능하게 한다.

## 단위 테스트 잠금 가능성 — 제약 보고

작업 지시는 "가능하면 헬퍼 단위테스트로 error→false 잠금"을 요청했으나, **현재 구조상 직접 단위테스트가 불가능**하다. 근거:

- `main.mjs`는 **export가 0개**다. `getEntityGraphEnabled`는 모듈 내부 함수이며 외부에서 import할 수 없다.
- `main.mjs`는 import 즉시 `app.whenReady().then(...)`(`:2240`) 등 Electron 앱 라이프사이클을 실행한다. `node --test`(데스크탑 테스트 러너, `package.json` → `node --test tests/*.test.mjs`) 환경에서 import하면 Electron 부트스트랩이 돌아 테스트가 불가능하다.
- 기존 테스트(예: `tests/entity-extractor.test.mjs`)는 **별도 모듈로 export된 함수 + fake supabase 주입** 패턴이다. main.mjs 내부 헬퍼를 테스트하는 선례가 없다.

→ **소규모 fix 범위에서는 헬퍼를 별도 모듈로 추출(export)하는 리팩토링까지 하지 않는다(범위 초과).** 대신 아래 검증으로 충분하다고 판단. (헬퍼 추출 단위테스트는 별도 후속 작업으로 백로그 등록 권장.)

## 검증 방법

1. **문법 체크 (필수)**: `node --check apps/desktop/electron/main.mjs` 통과 확인.
2. **기존 테스트 회귀 (필수)**: `apps/desktop`에서 `npm test`(`node --test tests/*.test.mjs`) 통과 — 본 수정이 기존 동작을 깨지 않음을 확인.
3. **수동 검증 (컬럼 부재 시나리오, 가능 시)**: dev DB에서 `entity_graph_enabled` 컬럼을 임시로 drop 후 QA 1건 실행 → throw 없이 plain RAG로 응답 생성되고 콘솔에 `[entity-graph] ... defaulting to OFF` 경고 1회 출력 확인 → 컬럼 복구. (선택: dev DB 변형이 부담되면 생략하고 1·2로 갈음.)
4. **diff 리뷰 (필수)**: 변경이 `getEntityGraphEnabled` 한 함수의 에러 처리 블록에만 국한되고, `throw`가 제거되었는지 확인.

## 영향 범위

- **수정 파일**: 1개 (`apps/desktop/electron/main.mjs`), 1개 함수, 사실상 1줄(throw → warn+return false).
- **사이드 이펙트**: 없음.
  - 정상 경로(컬럼 존재, 에러 없음) 동작 불변 — `pref?.entity_graph_enabled === true` 그대로.
  - 에러 경로만 throw → false로 변경. 호출부 1152(try 내부)·2451(else 분기 plain RAG)·2931(IPC, success:true로 OFF 표시)·1493(graph ON일 때만 도달, 영향 없음) 모두 false 반환을 안전하게 흡수.
- **DB 변경**: 없음.
- **새 IPC**: 없음.
- **`CURRENT_EXTRACTION_VERSION` 범프**: 불필요 (추출 로직 변경 아님, 에러 처리 hardening).
- **`DB_QUERY_TABLES`/`DB_MUTATE_TABLES` 화이트리스트**: 변경 없음.

## 규모 판단

- 수정 파일 1개 / DB 변경 없음 / 새 IPC 없음 / 새 컴포넌트·모듈 없음 → **소규모 수정 (`/fix`)**.

## 가정 사항

- **[가정]** 컬럼 부재 환경에서 PostgREST가 `error`(non-null)를 반환한다고 가정(빈 결과가 아니라 에러). `.maybeSingle()` + 존재하지 않는 컬럼 `select`는 PostgREST에서 에러로 처리되는 것이 일반적이며, 본 수정은 에러 형태와 무관하게 모든 에러를 false로 흡수하므로 가정이 어긋나도 안전하다.
- **[가정]** `console.warn`의 `error.message`에 민감정보가 없다고 가정(PostgREST 컬럼/스키마 에러 메시지). userId는 로그에 넣지 않음.

## 후속 권장 (이번 fix 범위 외)

- `getEntityGraphEnabled`/`getEntityExtractionModel` 등 `user_workspace_preferences` 조회 헬퍼군을 별도 모듈로 추출해 fake supabase 기반 단위테스트로 error→fallback을 잠그는 작업을 백로그에 등록. (main.mjs export 부재 + 부트스트랩 부작용 해소 필요 — 별도 plan 대상.)
