# Post-Plan 12 Roadmap — 테스트 토대 + 품질 측정 + 회복력

> 유형: strategy proposal | 작성일: 2026-05-21 | 작성자: Claude
> 갱신: 2026-05-21 Codex cross-agent 의견 반영 (v2 — Q13 two-tier, Phase 1 세분, degraded mode)
> 대상 의사결정자: 사용자 (huckwnmo99)
> 선행: Plan 12 (architecture/debuggability refactor) — Stage 2B 진행 중
> 동반 문서: `2026-05-21-roadmap-explained-kr.md` (쉬운 설명)

## 1. 배경 — 왜 이 로드맵이 필요한가

Plan 12 (2026-05-07 ~)로 monolith 분해가 크게 진행됐다:

- `main.mjs`: 4326 → ~2647 full lines
- `supabasePaperRepository.ts`: 1421 → ~673 lines
- 12+ 신규 모듈 (`chat/`, `rag/`, `paperRepository/`)

그러나 Redou를 비판적으로 점검한 결과, **production-grade의 핵심 기반이 약하다:**

| # | 약점 | 심각도 |
|---|------|--------|
| 1 | 테스트가 사실상 없다 (현재 14 suites / 69 tests — 전부 Plan 12 중 생성된 unit characterization, **통합/E2E 0개, 실제 DB 테스트 0개**) | 🔴 Critical |
| 2 | 외부 서비스 5개 의존 + V1 fallback 제거 (MinerU = single point of failure) | 🔴 Critical |
| 3 | RAG/추출 정확성 측정 불가 (ground truth 없음, Guardian 50셀 샘플링) | 🔴 Critical |
| 4 | 리팩토링 기회비용 — 제품 기능 2주+ 정지 | 🟡 Medium |
| 5 | 단일 사용자, 협업 기능 없음 | 🟡 Medium |
| 6 | 지식 집중 (모든 코드 AI 에이전트 작성, bus factor) | 🟡 Medium |

### 핵심 통찰

**Plan 12는 헛되지 않았다 — 테스트의 토대를 깔았다.**

모듈 분리로 `runMultiQueryRag`, `mergeExtractionResults`, `source-evidence` 등을 **독립적으로 테스트 가능**해졌다. 예전엔 4326줄 main.mjs를 통째로 띄워야 했다.

→ **다음 단계는 명확하다: 분리해놓은 seam에 진짜 테스트를 채운다.** 모듈을 더 쪼개는 것보다 이게 "디버깅 용이성"이라는 원래 목표에 훨씬 큰 기여를 한다.

> **가장 아이러니한 점:** Plan 12의 목표가 "디버깅 쉽게"였는데, 정작 디버깅을 어렵게 만드는 진짜 원인(테스트 부재)은 거의 안 건드렸다. 모듈을 쪼개도 테스트 없으면 회귀는 여전히 못 잡는다.

## 2. 로드맵 (우선순위 순)

### Phase 0: 진행 중인 것만 마무리 (1~3일)

**목표:** 리팩토링 treadmill 종료, 깔끔한 전환점 확보.

- Stage 2B (PaperDetailView 분리) 완료 — 이미 진행 중, 끝내는 비용 적음.
- Stage 5 (import/processing) **보류 결정** — job ordering fragile, 지금 가치 낮음. 필요 시 후속.
- 그 후 **module 분할 리팩토링 STOP.**

**완료 기준:** PaperDetailView 8 tab leaf 분리 완료, Plan 12 종료 선언.

---

### Phase 1: 테스트 토대 ⭐ (최우선, 가장 높은 레버리지)

**목표:** "build 통과"가 아니라 "핵심 시나리오 자동 검증"을 안전망으로.

> **Codex 통찰:** 가장 큰 기술 장벽은 Electron UI가 아니라 **DB fixture + deterministic external-service seams**다. golden-path를 한 번에 다 짜지 말고 **harness skeleton부터.**

**세분 단계 (Codex 제안 채택):**

**Phase 1A — fixture 전략 + harness skeleton (decision record)**
- **Q13 closing — two-tier fixture 전략:**
  - 통합 테스트 primary: **isolated local Supabase test instance/schema** (user dev data 절대 안 건드림). pgvector + RPC(match_chunks 등) + auth/RLS가 Postgres-specific이라 pglite로 대체 불가.
  - unit/module: recording fake + DI (현행 유지).
  - pglite: **나중에 optional** — RPC/pgvector/RLS 불필요한 pure repo/helper 테스트만.
- harness skeleton: schema setup (dev data 격리), file-library path/PDF artifact, job ordering assert (real worker sleep 없이).

**Phase 1B — golden-path 통합 테스트 1개**
- tiny fixture PDF (또는 fixture extraction result) → real-ish schema → fake MinerU/GROBID/Ollama/embedding → import/job/search/table persistence contract assert.
- browser UI / real external service 없음.
- 위치 후보: `apps/desktop/tests/integration/golden-path.test.mjs`

**Phase 1C — abort/error 테스트 + external-service fake catalog**
- Ollama 다운, MinerU 다운, 빈 결과, abort 중간 등 실패 경로.
- deterministic fake 카탈로그 (재사용 가능한 가짜 응답 모음).

**Phase 1D — (1B/1C에 포함 가능) 회귀 시나리오 확장.**

**추가 foundation (Codex 제안):**
- **Canonical fixture corpus directory** — tiny PDF + expected sections/chunks/figures + expected search/table outputs + fixture 갱신 규칙. 위치 후보: `apps/desktop/tests/fixtures/`
- **CI/runtime budget note** — golden-path가 minutes 걸리면 안 쓰이게 됨. 시간 예산 명시.

**완료 기준:** 핵심 시나리오 자동 검증, local Supabase fixture로 실DB 동작 확인, CI에서 budget 내 실행 가능.

**왜 최우선:** 이게 진짜 "디버깅 용이성"을 만든다. 이후 모든 작업(기능 추가, RAG 튜닝)의 회귀 안전망.

---

### Phase 2: RAG 품질 측정 (체감 → 측정)

**목표:** 검색/테이블 품질을 "좋아 보임"에서 "측정 가능"으로.

1. **Eval schema 먼저, 그다음 set 구축** (Codex 제안)
   - **eval schema(정답 형식)를 먼저 정의** — 1~2 carefully specified 예제로 runner 검증.
   - 그 후 논문 10~20편 + 알려진 Q&A/테이블 정답 쌍으로 확대.
   - 위치 후보: `docs/eval/rag-eval-set/`

2. **3개 지표 측정**
   - Retrieval recall (관련 chunk를 찾았나)
   - Table cell accuracy (셀 값이 맞나)
   - Hallucination rate (없는 값을 만들었나)

3. **회귀 감지 파이프라인**
   - RAG 파라미터(RRF 가중치, threshold, chunk size 등) 변경 시 3 지표 자동 측정.
   - "RRF 가중치 바꿨더니 recall 5% 하락" 같은 정량 피드백.

**완료 기준:** RAG 변경 시 품질 변화를 숫자로 확인 가능. Guardian 50셀 샘플링 한계도 정량화.

---

### Phase 3: 서비스 회복력 (fragility 완화)

**목표:** 5개 서비스 의존 + V1 fallback 제거의 위험 완화.

1. **Health check (임포트 전)**
   - 임포트 시작 전 5개 서비스 상태 체크.
   - ProcessingView 모니터링 확장.

2. **Labeled degraded mode (Codex 정정 — silent V1 revival X)**
   - MinerU 다운 → health check가 unavailable 표시 (import 시작 전).
   - 사용자가 retry 또는 **"text-only degraded import"** 선택.
   - degraded output은 **text-only / no figure-table confidence로 명시 flag.**
   - RAG/table workflow가 그 source의 낮은 신뢰도 인지.
   - → honesty 보존 + 전면 중단 회피. **V1을 MinerU 동급으로 silent 부활시키지 않음.**

3. **transient 실패 retry**
   - 네트워크 일시 오류에 circuit-breaker / 재시도.

**완료 기준:** 어느 서비스가 다운돼도 명확한 에러 + 복구 안내 + labeled degraded 동작 (가능 시).

---

### Phase 4: 제품 기능 복귀 (사용자 가치)

**목표:** 테스트 + 측정 토대 위에서 안전하게 기능 추가.

- 엔티티 그래프 확장 (multi-hop, 인용 네트워크)
- supplementary PDF 마무리
- Agentic NULL 재검색 (Step 4 로드맵)
- 기타 backlog

**이제 테스트가 있으니 기능 추가가 회귀를 안 만든다.**

---

## 3. 메타: 프로세스 개선 (병행)

1. **지식 집중 해소** — `CONTEXT.md` + onboarding 문서로 사람이 전체 구조 이해 가능하게.
2. **리뷰 경량화** (이미 합의) — codex-claude 의례적 리뷰 → blocking + 측정값만.
3. **migration squash** (선택) — 24개 누적 정리.

## 4. 전체 시퀀스

```
Phase 0: Stage 2B 완료 → 광범위 refactoring STOP
   ↓
Phase 1A: fixture 전략 (local Supabase primary) + harness skeleton
Phase 1B: golden-path 통합 테스트 1개 (deterministic fakes)
Phase 1C: abort/error 테스트 + external-service fake catalog
   ↓
Phase 2: RAG/table eval schema → 첫 tiny eval set → 3 지표 + 회귀 감지
   ↓
Phase 3: service health / labeled degraded-mode
   ↓
Phase 4: 제품 기능 복귀 (안전하게)
```

(Codex cross-agent 합의 버전. Stage 5 import/processing은 reliability series로 사용자가 명시 선택 시에만.)

## 5. 핵심 원칙

1. **"module을 더 쪼개고 싶은 충동"을 멈추고 테스트로 전환.** 분리한 seam이 아깝지 않으려면 거기 테스트를 채워야 한다.
2. **측정 없이는 개선 없다.** RAG 품질은 ground truth로 측정.
3. **fragility를 먼저 막고 기능을 추가.** 5 서비스 의존을 방치한 채 기능을 늘리면 깨질 지점만 증가.
4. **제품 가치로 복귀.** 내부 품질이 충분해지면 사용자 기능으로.

## 6. 위험 / 트레이드오프

| 위험 | 대응 |
|------|------|
| 테스트 작성도 시간 소요 — 또 다른 "내부 작업" | golden-path 1개부터 — 최소 투자로 최대 커버. 완벽 추구 안 함 |
| Eval set 구축이 수작업 | 10~20편으로 시작, 점진 확대 |
| pglite/fixture 도입이 새 의존성 | Q13에서 trade-off 측정 후 결정 |
| 제품 기능 복귀가 더 늦어짐 | Phase 1~3이 기능 추가를 *더 빠르고 안전하게* 만듦 — 투자 회수 |

## 7. 의사결정 요청

1. **이 로드맵 방향 승인 여부** (Phase 0~4 순서)
2. **Phase 1 첫 슬라이스 (golden-path 통합 테스트) 시작 승인**
3. **Q13 fixture 전략** (pglite 추천 / local DB / mock)
4. **Codex와 이 로드맵 의견 교환 후 진행 여부**

## 8. 다음 단계

승인 시:
1. 이 제안서를 `/plan` 거쳐 Phase 1 구현 계획서로 구체화.
2. Phase 1 첫 슬라이스 Codex와 진행.
3. 또는 Codex와 로드맵 cross-agent 의견 교환 먼저.
