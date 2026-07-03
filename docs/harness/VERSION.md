# Harness Version

## v1.17 — 2026-07-03
- 같은 conversationId 동시 `CHAT_SEND_MESSAGE` abort 레지스트리 붕괴 수정 (fix B-R1, `pipeline-risk-audit`). 수정 1파일(`main.mjs`, CHAT_SEND_MESSAGE 범위만). DB/IPC 채널/frontend/`CURRENT_EXTRACTION_VERSION` 무변경.
- 4지점 변경: (0) abort 컨트롤러 변수를 핸들러 최상단 `let abortController = null`로 호이스팅(`main.mjs:2650`) — finally identity guard가 컨트롤러를 참조하려면 try 밖 스코프 필요, 기존 try 내부 `const` 선언을 상단 `let`+할당으로 전환. (1) **in-flight 거부 가드**(`main.mjs:2684`): convId 확정 직후·사용자 메시지 insert(2689) 전에 `chatAbortControllers.has(convId)`면 `{ conversationId, error: "A response is already being generated for this conversation." }`를 **직접 return**(try 안이지만 catch 미경유 → DB insert·CHAT_ERROR emit 없음). 신규 대화(방금 생성한 convId)는 항상 미충돌이라 자연 통과. (2) **finally identity guard**(`main.mjs:2768`): `if (abortController && chatAbortControllers.get(convId) === abortController) delete` — 거부 early return 시 abortController=null이라 요청1 엔트리 보존, abort 후 재전송 레이스에서 늦은 finally가 새 요청 엔트리를 지우지 않음. (3) CHAT_ABORT 무변경 — get→abort→delete 유지(취소 직후 재전송 허용), identity guard와 조합 안전 교차확인(CHAT_ABORT의 delete는 A만 제거, 늦은 요청1 finally는 get≠A로 스킵).
- 거부 반환 형태 `{ conversationId, error }`는 공통 catch 반환(`main.mjs:2763`)과 동일 구조 → frontend 기존 에러 경로가 그대로 처리, 신규 이벤트 계약·frontend 변경 불필요([가정] 성립).
- 사용자 가시 변화: 진행 중 대화에 재전송하면 완료 전까지 거부(이전: 조용히 이중 실행 → abort 불능 + assistant/table 중복 영속화).
- 검증: `node --check apps/desktop/electron/main.mjs` 통과 · `node --test apps/desktop/tests/*.test.mjs` **65건/14스위트 전부 통과**(수정 전후 동일, 회귀 없음). 단위 테스트는 CHAT_SEND_MESSAGE/CHAT_ABORT 핸들러가 `main.mjs` 인라인 등록·**미export**(main.mjs에 export 전무)이고 supabase 싱글턴 강결합이라 미추가 → completed 문서에 사유 + 수동 검증 3절차(테이블 생성 중 재전송→거부·중복 없음 / 생성 중 abort→즉시 중단 / abort 직후 재전송→정상 시작) 기록. 커밋은 사용자.
- `detail/electron/main-process.md`(v1.13): "현재 상태"에 동시 전송 거부 + finally identity guard 동작 한 줄 추가.

## v1.16 — 2026-07-03
- `persistV2Results` 재추출 delete→insert 비트랜잭션을 **지연 삭제(old-id)**로 전환 (fix A-R2, `pipeline-risk-audit`). 수정 1파일(`main.mjs`, `persistV2Results` 범위만). DB/IPC/컴포넌트/마이그레이션·`CURRENT_EXTRACTION_VERSION` 무변경.
- 맨 앞 3개 delete(`paper_chunks`/`figures`/`paper_sections`) 제거 → 함수 진입 시 old id만 조회·보관(`oldSectionIds`/`oldChunkIds`/`oldFigureIds`, `main.mjs:600-608`). 새 행은 old와 공존시켜 전부 insert, **모든 insert·링크·references 성공 후**(버전 범프 직전, `main.mjs:827-845`) 보관한 old id만 `.in("id", oldIds)`로 삭제(빈 배열 스킵). 중간 insert 실패 시 old 보존 → 논문 "빈껍데기" 잔존 위험 제거.
- `figure_chunk_links`가 old figure를 참조하지 않도록 tables/equations insert에 `.select("id, page, item_type")` 추가 → 링크 소스를 "DB 재조회(old+new 혼입 위험)"에서 "방금 insert한 새 행"으로 교체. 링크 생성 로직·`fig.id`/`fig.page` 접근·동작 동치.
- [가정 검증] CASCADE 성립(`initial_schema.sql`): `chunk_embeddings.chunk_id`(:124)·`figure_chunk_links.figure_id`(:176)/`chunk_id`(:177) 전부 ON DELETE CASCADE → old chunk/figure 삭제 시 old 임베딩·링크 자동 정리. figure 임베딩은 별도 테이블 아닌 `figures.embedding` 컬럼(row 삭제로 함께 제거). `paper_chunks.section_id`는 SET NULL이나 새 chunk가 새 section만 참조하므로 old section 삭제 영향 없음.
- 한계: 완전 원자성은 아님(old delete 3건 도중 사고 시 old+new 잠깐 중복 잔존, 재추출로 정리 — 빈껍데기보다 안전). 완전 원자성은 향후 방향 ②(Postgres RPC 트랜잭션) 별도 slice.
- 검증: `node --check apps/desktop/electron/main.mjs` 통과 · `node --test apps/desktop/tests/*.test.mjs` **65건/14스위트 전부 통과**(회귀 없음). 단위 테스트는 `persistV2Results` 미export + `supabase` 싱글턴 강결합으로 미추가 → completed 문서에 수동 검증 절차(실패 주입 시 old 보존 / 정상 시 새 1세트만 잔존·dangling 없음) 기록. 커밋은 사용자.
- `detail/electron/pdf-pipeline.md`: V2 실행 흐름 9번에 지연 삭제 동작 반영.

## v1.15 — 2026-07-03
- 청크 임베딩 배치 부분 실패 격리 (fix A-R1, `pipeline-risk-audit`). 수정 2파일(`embedding-worker.mjs`, `main.mjs`). DB/IPC/컴포넌트/마이그레이션·`CURRENT_EXTRACTION_VERSION` 무변경.
- `generateEmbeddings`(embedding-worker.mjs): 배치 내 `Promise.all` → `Promise.allSettled`. fulfilled만 `results[i+j]` 채우고 `completed++`, rejected는 슬롯 undefined 유지 + `console.warn(chunk N …)` 로깅. 반환 길이는 여전히 `texts.length`(실패 인덱스=undefined). 청크 1개 vLLM 오류가 배치 전체를 reject시켜 논문 임베딩 job을 죽이던 문제 해소.
- `processEmbeddingJob` 호출부(main.mjs): `rows` 생성 시 undefined/null 임베딩 청크 filter로 제외(성공분만 upsert, `JSON.stringify(undefined)` 방지). `failedCount` 로깅. 부분 실패 정책 — 성공 ≥1이면 job=succeeded(그림 경로와 일관), 성공 0(전부 실패)이면 throw로 job=failed→재큐. `embeddedCount`를 `chunksToEmbed.length`→실제 성공분 `rows.length`로 정정.
- [가정 검증] `chunksToEmbed`(main.mjs:1272-1280)는 `chunk_embeddings`에서 현재 `MODEL_NAME`으로 임베딩된 청크를 `existingSet`으로 빼고 미임베딩분만 선별함을 코드로 확인 → 부분 실패 후 재큐 시 실패분만 재시도(성공분 재임베딩 없음). slice [가정] 성립.
- 테스트: `tests/embedding-worker.test.mjs` 신설 — `globalThis.fetch` stub으로 특정 청크만 500 실패시켜 실제 `generateEmbeddings` 검증(성공분 유지·실패 슬롯 undefined·throw 안 함·onProgress 성공 개수만·전부 실패도 무throw) 3케이스. 전체 데스크탑 스위트 `node --test tests/*.test.mjs` 65건/14스위트 전부 통과.
- `detail/electron/embedding.md`(v1.15): 청크 임베딩 흐름에 부분 실패 격리 블록 + 현재 상태 갱신(A-R4 타임아웃 미해결 cross-ref). 검증: `node --check` 2파일 통과. 커밋은 사용자.

## v1.14 — 2026-06-24
- PDF 줌 앱 전체 누수 수정 (fix: `pdf-zoom-app-wide-leak`). 수정 1파일(`main.mjs`). DB/IPC/컴포넌트/마이그레이션·`CURRENT_EXTRACTION_VERSION` 무변경.
- `lockWebContentsZoom(webContents)` 헬퍼 추가 — Electron 기본 webContents 줌(앱 전체 줌)을 비활성화: `setVisualZoomLevelLimits(1,1)`(핀치 차단) + `before-input-event`로 Ctrl/Cmd+`=`/`+`/`-`/`0` 차단 + `setZoomFactor(1)`/`zoom-changed` 1 고정. 메인 창(`createMainWindow()`)·detached 패널 창(`window:detach-panel`) 양쪽에서 호출.
- 원인: BrowserWindow에 줌 제어 부재 → PDF scroll container 밖/비-PDF 화면에서 Ctrl+휠·Ctrl+= 가 앱 UI 전체를 `zoomFactor`로 확대. PDF 리더 자체 scale 줌(`PdfReaderWorkspace`)은 React state 기반·독립이라 무변경·보존.
- `detail/electron/main-process.md`: "창 줌 잠금" 섹션 추가. 검증: `node --check apps/desktop/electron/main.mjs` 통과. 커밋은 사용자.

## v1.13 — 2026-06-17
- `detail/electron/chat-table-pipeline-state.md` 트리밍: 1234줄→270줄. 작업 과정 로그(Stage 2A tracer bullet 13개, Plan 12 Stage 3 슬라이스, fix 18/19 구현 기록, Verification Commands[ADR 0002와 중복]) 제거 → '현재 상태'만 유지(Files Read~Extraction Targets). 이력은 git history.
- `decisions/0002-module-ownership.md` 자립화: 삭제된 codex-claude의 D8 종속 제거(D8 Mapping → Source Of Truth). 이 ADR이 `main.mjs` module ownership의 단일 진실원천.
- 배경: 파일 길이 규칙 신설(CLAUDE.md — 문서 ~500줄 상한, harness는 '현재 상태'만), Codex 전면 배제로 `docs/agents/codex-claude/` 폴더 삭제.

## v1.12 — 2026-06-15
- harness 갭 보강(docs-cleanup 후속). 엔티티 그래프 커버리지 누락 + DB 문서 노후화(4월) 정리.
- 신설 `detail/electron/entity-graph.md` — entity-extractor.mjs + graph-search.mjs (opt-in 추출·그래프 RAG, entities/entity_relations 테이블, RPC 3개).
- `detail/database/schema.md` 갱신 — 마이그레이션 20→27개, 엔티티 테이블 2개 + `extract_entities` enum + `entity_extraction_version`/`entity_extraction_model`/`entity_graph_enabled` 컬럼.
- `detail/database/rpc.md` 갱신 — 엔티티 RPC 3개(match_entities, resolve_same_as, graph_traverse_1hop).
- `main/feature-status.md` 헤더 버전 동기화(v1.8→v1.12) + 엔티티 행 detail 링크.
- electron detail 노후 갱신: `llm.md`(6월 `chat/*` 모듈 분리·`chat-table-pipeline-state.md` 포인터), `main-process.md`(엔티티 IPC·분리 모듈 의존성·archive된 ROADMAP 참조 제거), `embedding.md`(엔티티 임베딩 cross-ref).
- 검토 후 무변경(이미 현행): `pdf-pipeline.md`(v2.0, V2 단일·V1 제거 반영), `services/external.md`(UniMERNet 미사용 반영).

## v1.11 — 2026-06-09
- Per-paper 추출 타임아웃 env화 (fix 20). `chat/table-pipeline.mjs` 1파일 — Stage 3b/3d hard timeout의 하드코딩 ms를 모듈 상수 + env로 분리
- 상수 2개(import 직후): `PER_PAPER_TIMEOUT_MS = parseInt(process.env.REDOU_PER_PAPER_TIMEOUT_MS,10)||240000` (Stage 3b per-paper, 기본 240초·권장 상한 300초=내부 ollamaSignal 정합), `NULL_RECOVERY_TIMEOUT_MS = parseInt(process.env.REDOU_NULL_RECOVERY_TIMEOUT_MS,10)||30000` (Stage 3d NULL 재검색, 기본 30초 유지). 두 setTimeout의 60000/30000을 각 상수로 치환
- 값만 상수+env로 치환 — wrapper의 AbortController/사용자 abort 전파/clearTimeout/catch 분기는 무변경. 근본 원인: 60초 wrapper가 내부 ollamaSignal 300초보다 먼저 abort=binding → gemma4:31b가 60초 안에 못 끝내 per-paper 4편 전부 timeout→fallback→빈 테이블
- item 3(fail placeholder/사유)은 이미 fix 19에 구현·배선 완료 → 신규 코드 없음. 타임아웃 상향 효과=per-paper 최소 1편 성공 시 fallback 회피→merge 진입→fix19 placeholder/사유 발현
- DB/IPC/컴포넌트·CURRENT_EXTRACTION_VERSION 무변경. 검증: node --check 통과 + env 시맨틱(미설정→기본값, override, invalid→폴백) + 단위 테스트 28건(table-pipeline 22 + table-extraction 6) 전부 통과

## v1.10 — 2026-06-08
- fix 18 **P0-A 전용 기능/회귀 테스트 추가** (프로덕션 코드 무변경 — `tests/table-pipeline.test.mjs`에 테스트 케이스만 3건 추가). v1.9에서 "abort 재throw/비차단 동작은 기존 fallback·abort 케이스로 커버"라고 적었으나 timeout→빈 테이블 전환을 직접 실증하는 전용 케이스는 없었음 → 이번에 명시적으로 추가해 "timeout fix가 실제 작동하는가"를 기능 검증
- 케이스 1(비차단): empty-merge 경로(per-paper 전부 빈 값)에서 `generateTableFromSpecFn`이 `DOMException("…","TimeoutError")` throw → `runTableConversationPipeline`이 **throw하지 않고 정상 반환**, 영속화된 테이블 `rows:[]` + 어시스턴트 메시지 content의 `tableJson.notes`에 "시간 내에 완료되지 못…" 포함, `metadata.extractionMode="single_call_fallback"` (P0-A 핵심 = 에러 화면 대신 빈 테이블 실증)
- 케이스 1-변형(일반 에러): fallback이 일반 `Error` throw 시에도 동일하게 빈 테이블로 salvage
- 케이스 2(abort 전파): fallback에서 `abortController.abort()` + `AbortError` throw(실사용자 취소 레이스 모방) → `runStage3cMergeFallback`의 `throwIfChatAborted(abortSignal)`(`table-pipeline.mjs:599`)가 `abortSignal.aborted` 감지해 **AbortError 재throw** → `assert.rejects(..., err=>err.name==="AbortError")` + `chat_messages`/`chat_generated_tables` 미insert 검증 (취소 보존 = P0-A 경계조건)
- 미작성(이유): "per-paper 부분성공분 salvage(mergedTableJson rows>0)" 변형은 **공개 진입점으로 도달 불가** — 병합이 rows>0이면 `runStage3cMergeFallback`이 fallback 분기에 진입하지 않으므로(`!extractionFallbackNeeded`에서 merge→rows 있으면 fallback skip) `mergedTableJson` salvage 브랜치는 프로덕션 흐름상 빈-merge 후 빈 테이블 케이스로 귀결. 프로덕션 코드 수정 없이는 인위적 재현 불가라 미작성(로그 재현 케이스도 4편 전부 data_rows=0 = 빈 테이블 케이스와 동일)
- 검증: `node --check` 3파일(test + table-pipeline.mjs + table-extraction.mjs) 통과 · `node --test tests/table-pipeline.test.mjs` **21건 전부 통과**(기존 18 + 신규 3) · 전체 데스크탑 단위 스위트 `node --test tests/*.test.mjs` **60건/13스위트 전부 통과**(회귀 없음). 커밋은 사용자
- chat-table-pipeline-state.md: "fix 18 P0-A Regression Test Coverage" 섹션 추가. feature-status.md: fix 18 행 테스트 노트를 전용 케이스 3건 + 60건 통과로 갱신

## v1.9 — 2026-06-08
- 테이블 생성 타임아웃 (single-call fallback DOMException TimeoutError) 수정 — fix 18의 **P0-A + P0-B만** 구현 (P1/P2 미구현). 수정 파일 2개: `chat/table-pipeline.mjs`, `chat/table-extraction.mjs`
- **P0-A (fallback 비차단화)**: `runStage3cMergeFallback`의 단일호출 fallback(`generateTableFromSpecFn` + 정규화)을 try/catch로 감쌈. 사용자 abort는 `throwIfChatAborted`로 재throw, timeout/일반 에러는 병합 부분결과(있으면) 또는 빈 테이블(`rows:[]` + notes="표 생성이 시간 내에 완료되지 못했습니다…")을 반환 → 에러 화면 대신 결과 표시. `extractionMode="single_call_fallback"` 유지로 Stage 3d 건너뜀(nullSummary=null), persistTableReport는 rows:[] 안전 처리. 병합 부분결과 보존용 `mergedTableJson` 변수 추가
- **P0-B (fallback 컨텍스트 축소)**: `assembleRagContext`에 옵셔널 5번째 인자 `budget={ocr,matrix,total}` 추가(미지정 시 기존 기본값 OCR 70K/MATRIX 35K/TOTAL 120K 유지 → main.mjs Q&A 경로 무영향). 신규 export 상수 `FALLBACK_RAG_BUDGET`(OCR 30K/MATRIX 20K/TOTAL 60K)을 Stage 3c fallback 호출에서만 전달 → ~120K→~60K 축소로 로컬 Ollama 300초 timeout 회피
- 정상 경로(per-paper 성공→병합)·frontend 무변경. `CURRENT_EXTRACTION_VERSION` 범프 불필요(채팅 런타임 로직만 변경, 추출 산출물/임베딩 스키마 불변)
- 검증: `node --check` 2파일 통과 · 데스크탑 단위 테스트(Node `node --test tests/*.test.mjs`) **57건 전부 회귀 통과**(table-pipeline.test.mjs + table-extraction.test.mjs 23건 직접 실행 + 전체 스위트 재실행 확인) · abort 재throw/비차단 동작은 기존 `table-pipeline.test.mjs`의 fallback·abort 케이스로 커버
- rag-pipeline.md: `assembleRagContext` 시그니처에 `budget?` 반영 + 데이터 흐름에 Stage 3c fallback 비차단화/축소 budget 블록 추가
- feature-status.md: fix 18 항목을 `🟡 부분 구현 (P0-A + P0-B 완료, P1/P2 미구현)`으로 갱신 (timeout 항목 1줄만 — advisor 등 무관 변경 미개입). 커밋은 사용자가 수행

## v1.8 — 2026-05-31
- NotesView 디자인 킷 이식 (리디자인 5호 화면). 방향 A 채택. `NotesView.tsx` 단일 파일 전면 재구성 — 데이터/IPC/스토어/타입/DB/Electron/`tokens.css` 무변경
- IA 전환: 전체폭 2-grid(논문별 그룹 리스트 / 에디터) → 킷 **3-pane**(좌 리스트 패널[제목+카운트+New / 검색 / 종류칩 / 논문·정렬 CompactSelect / flat 리스트] + 드래그 `ResizeHandle` + 우 캄 에디터). 페이지 외곽 패딩 제거(`display:flex; height:100%; overflow:hidden`)
- 신규 인터랙션 4종(전부 로컬 useState, 부수효과 0): 노트 검색(`matchesSearch` 제목·본문 lowercase includes) + 정렬(`sort`: updated/created/title/kind — 실 `updatedAt`/`createdAt`/`title`/`kind`, pinned 우선) + **종류별 필터칩**(`kindFilter`, `NOTE_KIND_KEYS=Object.keys(noteKindMeta)` 순회) + **리스트↔에디터 드래그 리사이즈**(`listWidth` 280~560px lazy init + `localStorage["redou.notes.listWidth"]`, `dragCleanupRef` + unmount cleanup으로 리스너 누수 방지)
- 보조 컴포넌트(파일 내): `NoteList`/`KindChip`(색 점+라벨+카운트)/`CompactSelect`(논문[글로벌 selectedPaperId]·정렬, SVG chevron 인라인)/`NoteCard`(좌측 종류색 보더+칩/핀+날짜+제목 ellipsis+2줄 클램프+논문·p.N 푸터)/`ResizeHandle`(hover 인라인)/`NoteEditor`/`NoteKindSelect`(킷 NoteKindChip 시각+투명 native select 오버레이=실 draft.kind 변경)/`MetaChip`/`SaveStatus`(dirty 반영)/`IconButtonNotes`(pin 실 토글)/`EmptyEditor`
- 보존: controlled `draft`+`isDraftDirty`/`handleSave`(`useUpdateNote`, `anchorLabel: linkedSelectionNote ? undefined` 분기 유지)·`handleCreateNote`(`useCreateNote`)·`openNoteSource`/`openPaperNotes`(`setReaderTargetAnchor`+`openPaperDetail`)·`linkedSelectionNote`(highlightId||linkedAnchor) 하이라이트 연결+`activeQuote` 인용 배너·앵커 input linked 잠금(linked 시 미표시)·`useAllNotes`/`useAllPapers`·`noteKindMeta`/`formatNoteDate`(읽기만)·타입(any 0)·i18n `t()`·노트 전환 시 `useEffect` draft 동기(킷 `key`+defaultValue 트릭 미채택)
- 미채택(가짜): 킷 발명 종류 `idea`/`comparison`/`todo` **폐기**(실 `NoteKind` 6종 summary/insight/question/quote/action/memo만 — DB `KIND_TO_DB` 매핑 일치), 킷 `defaultValue`+`key` 입력 트릭(controlled 유지), 무조건 "저장됨" 배지→실 dirty(미저장 시 accent dot), `onNew` 빈함수→`handleCreateNote`, "소스로 이동"/핀 무동작→실 액션, **삭제(trash) 버튼 미이식**(삭제 기능 없음·가짜 노출 금지), **⌘S/⌘⏎ kbd 힌트 미이식**(키 바인딩 없음·가짜 노출 금지 — 워드/문자 카운트는 실 계산으로 유지)
- [가정 A] 종류칩/에디터 칩 색 점만(아이콘 없음, `noteKindMeta`에 icon 필드 없음). [가정 B] 종류 라벨 영문 `meta.label` 단일. [가정 C] 논문 필터=글로벌 `selectedPaperId` 유지(리더·소스이동 동선 보존), `groupedNotes` 그룹 헤더 제거→flat 리스트+카드 푸터 논문명. [가정 D] 드래그 리사이즈 이식. [미결 2] 종류 변경=투명 select 오버레이(동작 보존)
- `.scroll-y` 클래스 미정의→인라인 `overflowY:auto`(Figures/Settings 선례). lucide named import 정리(`BookOpen`/`Save` 제거, `ArrowUpDown`/`Bookmark`/`Check`/`ChevronDown`/`Clock`/`Pin`/`Quote`/`Search`/`SearchX`/`X` 추가)
- 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과. ESLint 미설정(eslint.config 없음·미설치). `CURRENT_EXTRACTION_VERSION` 범프 불필요. 커밋/비주얼 검증은 리뷰 단계
- feature-status.md: NotesView 리디자인 행 ✅ 구현됨 처리. notes.md(v1.1): 3-pane IA·신규 인터랙션·보존 로직·종류 6종으로 전면 갱신. flows.md: 노트 작성 흐름에 검색/정렬/종류필터/드래그 + 보존 로직 반영

## v1.7 — 2026-05-31
- SearchView 디자인 킷 이식 (리디자인 4호 화면). 방향 A(paper-centric 집계 유지) 채택. `SearchView.tsx` 단일 파일 시각 재구성 — 데이터/IPC/스토어/타입/모델/DB/Electron/`tokens.css` 무변경
- 이식: 중앙 컬럼(maxWidth 820, padding 32/24/80) + 검색바(height 54 + 포커스 글로우 `0 0 0 4px accent-subtle` + ⌘K kbd[focus 핸들러] + Esc clear) + **Hybrid 정보 칩**(가짜 Semantic/Keyword 토글 대체) + 카테고리 **7칩**(소스 아이콘+카운트, count=0 disabled) + 결과 카드 3단(좌측 소스 레일[대표 소스+p.N] / 본문[제목·스니펫+키워드 `<mark>`] / 우측[매치% 색뱃지+Open→]) + 하단 다중 소스 뱃지 유지 + 빈상태(eyebrow + Try칩 + 최근 논문[실데이터]) + 결과없음(search-x + 2줄)
- 신규 헬퍼(표시용·로직 무관): `highlightSnippet`(실 쿼리 토큰 `<mark>`, `containsLatex` true면 `LatexText`로 분기·mark 미적용), `chipCounts`(scope별 매칭 논문 수 — `buildUnifiedResults` 재호출 없이 동일 검색 입력에서 도출, figures/equations는 itemType 분리), `eyebrowStyle` 인라인, `sourceLabels`에 per-source `color` 필드(킷 SOURCE_META 차용)
- 보존: 하이브리드 4훅(`useSemanticChunk/Paper/FigureSearch` + `useSearchHighlightEmbeddings`) + `buildUnifiedResults`/`buildSearchGroups`/`semanticResultsToChunks` 퓨전 + evidence 집계 + 매치%(실 pgvector cosine) + `handleCardClick` PDF점프 + 카테고리 7종(equations 포함) + `LatexText` KaTeX + 타입(any 0) + i18n `t()`. lucide named import에 `Sparkles`/`SearchX`/`ArrowRight` 추가
- 미채택(가짜): RECENT_SEARCHES 하드코딩, all-MiniLM 오모델명, "전체 라이브러리" 버튼(SearchSidebar 중복), 키보드 힌트 푸터, 킷 수동 `**` 파싱, kit 화학-특정 Try 예시. `SearchSidebar.tsx` 무변경(글로벌 소속)
- 빌드(tsc -b+vite) 통과·vitest 28건(searchModel 포함) 회귀 통과. ESLint 미설정(eslint.config 없음). `CURRENT_EXTRACTION_VERSION` 범프 불필요. 커밋/비주얼 검증은 리뷰 단계
- feature-status.md: SearchView 리디자인 행 ✅ 구현됨 처리. search.md(v1.1): UI 구조/표시용 헬퍼/하이브리드 흐름으로 전면 갱신(구식 탭 설명 정정). flows.md: 시맨틱 검색 흐름을 하이브리드 paper-centric으로 정정

## v1.6 — 2026-05-30
- SettingsView 디자인 킷 이식 (리디자인 2호 화면). 킷 **2-pane 섹션 레이아웃**(좌측 Account/Workspace/Models/Desktop/About 네비 + 우측 Row 패널)으로 `SettingsView.tsx` 전면 재구성. 기본 진입 섹션=account
- 프리미티브 TS 포팅: `SectionHeader`/`RowGroup`/`Row`/`Select`(네이티브 select 래퍼)/`SegmentedControl`/`Button`(icon=lucide 컴포넌트, primary/secondary/danger)/`Toast`(중앙 하단 z-index 100, 2.5초)/`ComingSoonPill`("준비 중" 비활성 칩). `.eyebrow`→인라인 `eyebrowStyle`, `.scroll-y`→인라인 overflow (FiguresView 선례)
- 섹션 컴포넌트: `AccountSection`(auth+identity strip, session null 가드)/`WorkspaceSection`(locale SegmentedControl)/`ModelsSection`(LLM Select + entity 토글·모델·백필·프로그레스 바 통합 — 회귀 핵심)/`DesktopSection`(Runtime card + File/Backup/Pipeline + 선택 PDF·최근 백업 로컬 상태)/`AboutSection`(desktop.version·런타임 실제값)
- 보존: LLM 4훅 + entity 6훅(`useEntityGraphEnabled`/`useSetEntityGraphEnabled`/`useActiveEntityModel`/`useSetEntityModel`/`useEntityBackfillStatus`/`useStartEntityBackfill`) + 데스크톱 4훅 + auth 2훅 + `useUIStore.locale/setLocale` + 전체 핸들러 + 타입(any 0) + i18n(킷 한국어 하드코딩 전부 `t()`). 백필은 토글과 무관·`desktopReady` 가드 유지
- 미이식(백엔드 없음): Streaming/Guardian/Theme = 비활성 "준비 중" placeholder로 자리만 표시(동작 로직 미연결). Library 뷰·정렬·Password·Active sessions·**Delete account(danger zone)**·Diagnostics·서비스 health StatusPill = 완전 미이식(가짜 버튼/상태 노출 금지)
- 데이터 계층/IPC/스토어/DB/Electron/`tokens.css` 무변경. `CURRENT_EXTRACTION_VERSION` 범프 불필요. 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과. 커밋/비주얼 검증은 리뷰 단계
- feature-status.md: SettingsView 리디자인 행 ✅ 구현됨 처리. paper.md(v1.2): SettingsView 섹션 2-pane IA로 전면 갱신 + 파일 줄 수 보정

## v1.5 — 2026-05-30
- FiguresView 디자인 킷 이식 (리디자인 1호 시범 화면). 방향 A(1-pane 전역 갤러리) + 썸네일 A-1(paperId별 PDF doc 캐시) 채택
- `FiguresView.tsx` 전면 재구성: 2-pane(논문선택→그림) 폴더 동선 제거 → 필터칩(All/Figure/Table/Equation + 카운트) + 캡션·제목 검색 + 카드 그리드 + 라이트박스(키보드 ←/→/Esc)
- 실제 썸네일 로직 보존: `PageThumbnail`/`FigureImage`/`TableCropThumbnailCard`/`FigureCropThumbnailCard`/`usePaperPdfDoc`. 킷 가짜 placeholder 미채택
- 신규 `PaperDocCacheProvider`/`PaperDocLoader`/`usePaperDoc`(context): 전역 그리드에서 paperId별 PDF doc를 1개씩 공유 로드(imagePath 있는 그림은 doc 불필요)
- 신규 `FigureThumb`(실제 렌더 분기), `FigureCard`(킷 스타일+출처 라벨), `FigureGallery`, `FigureLightbox`(큰 미리보기=실제 렌더, "논문 열기"=`jumpToPage`)
- 보존: `useAllFigures`/`useAllPapers`/`usePrimaryPaperFile` 훅, `@/lib/desktop` IPC(`toDesktopFileUrl`/`useResolvedDesktopFilePath`/`useDesktopRuntime`), `useUIStore` PDF 점프 동선, `PaperFigure`/`Paper` 타입, `LatexText`(KaTeX 캡션), i18n `localeText`. 킷 한국어 하드코딩 전부 `t(en, ko)`로 래핑. `useFolders` import만 제거(Direction A에서 미사용)
- `tokens.css`: `--shadow-xs`, `--font-mono` 추가 + `.fig-card`/`.fig-zoom` hover 규칙(인라인 style로 :hover 불가)
- 데이터 계층/IPC/스토어/DB/Electron 무변경. `CURRENT_EXTRACTION_VERSION` 범프 불필요. 커밋/비주얼 검증은 리뷰 단계에서
- feature-status.md: FiguresView 리디자인 행 ✅ 구현됨 처리. paper.md: FiguresView 섹션 갱신(1-pane 갤러리). flows.md: Figure 갤러리 탐색 흐름 추가

## v1.4 — 2026-05-27
- Entity Graph opt-in 전환 (fix 16). `user_workspace_preferences.entity_graph_enabled` boolean(기본 false) 플래그로 자동 큐잉/QA graph 경로를 게이트
- 마이그레이션 `20260527073618_add_entity_graph_enabled.sql` 추가
- main.mjs: `getEntityGraphEnabled(userId)` 헬퍼, `enqueueEntityExtractionIfNeeded` 진입부 게이트, `handleQaPipeline` graph/plain 분기, `ENTITY_GET_GRAPH_ENABLED`/`ENTITY_SET_GRAPH_ENABLED` IPC 2개
- ipc-channels.mjs/preload.mjs: 채널 2개 + 브리지 2개. desktop.ts: `EntityGraphEnabledInfo` 타입 + entity 메서드 2개
- chatQueries.ts: `entityKeys.graphEnabled` + `useEntityGraphEnabled`/`useSetEntityGraphEnabled`. SettingsView.tsx: Entity Graph 패널에 opt-in 토글(수동 백필은 독립 유지, D1=나)
- feature-status.md: 엔티티 추출 행을 "✅ 구현됨 (opt-in, 기본 OFF)"로 갱신. flows.md: 임포트 흐름 opt-in 조건 + Q&A graph/plain 분기 정정. rag-pipeline.md: Q&A opt-in 섹션 추가. stores-queries.md: 엔티티/모델 훅 표 추가
- #15 미커밋분(paperSignals import+embedding 합성, ProcessingView 라벨, paperSignals.test.ts) 유지 — opt-in과 독립적으로 옳은 버그 수정. opt-in 전환으로 자동 entity job이 사라져 #15가 잡던 불일치는 신규 import에서 미발생(맥락만 하네스에 보정)

## v1.3 — 2026-05-27
- 라이브러리 "Complete" 상태와 실제 처리 상태 불일치 수정 (fix 15, 옵션 A1)
- `paperSignals.ts`가 core 파이프라인(import_pdf + generate_embeddings) 합성으로 카드 상태 계산 — 둘 다 succeeded일 때만 "Complete". entity는 제외(graceful-degradation)
- flows.md: PDF 임포트 흐름에 embedding 후 `extract_entities` 큐잉/처리 단계 추가
- feature-status.md: 엔티티 그래프 ✅ 구현됨 처리 + 라이브러리 카드 상태/엔티티 추출 항목 추가
- stores-queries.md: 라이브러리 카드 처리 상태 계산 섹션 추가

## v1.2 — 2026-04-10
- SRAG 통합 이슈 3건 수정 (Orchestrator clarify 과다 / 한글 인코딩 깨짐 / Guardian 검증 실패)
- llm.md 알려진 이슈 2~4번 수정 완료 처리

## v1.1 — 2026-04-10
- BM25 검색 0건 반환 버그 수정: `websearch_to_tsquery` → `build_or_tsquery` (OR 기반)
- database/rpc.md BM25 설정 섹션 갱신
- feature-status.md BM25 버그 상태 완료 처리

## v1.0 — 2026-04-10
- 초기 하네스 구축
- main/ 3개, detail/ 12개 파일 작성
- 코드베이스 실사 기반 (추측 없음)

## 변경 규칙
- major (v2.0): 하네스 구조 변경 (파일 추가/삭제/재편)
- minor (v1.1): 기존 파일 내용 갱신
- 모든 기능 추가/수정 커밋 시 관련 하네스 파일도 함께 갱신
