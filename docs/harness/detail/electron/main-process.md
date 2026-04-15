# Electron Main Process
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
Electron 앱의 진입점. 앱 라이프사이클, IPC 핸들러 등록, PDF 처리 파이프라인 오케스트레이션, DB 프록시, 채팅 파이프라인 전체를 관장한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/main.mjs` | 메인 프로세스 (모든 IPC + 파이프라인) | ~4035 |
| `apps/desktop/electron/preload.mjs` | Context bridge (IPC → 렌더러) | ~161 |
| `apps/desktop/electron/types/ipc-channels.mjs` | IPC 채널 이름 정의 | ~60 |

## 주요 상수
| 이름 | 값 | 위치 | 설명 |
|------|------|------|------|
| `CURRENT_EXTRACTION_VERSION` | 24 | main.mjs:98 | 추출 로직 버전. 변경 시 기존 논문 재처리 |
| `PROCESSING_POLL_INTERVAL_MS` | 2500 | main.mjs:91 | 작업 큐 폴링 간격 (ms) |
| `LIBRARY_ROOT` | `~/Documents/Redou/Library` | main.mjs:34 | PDF 저장 루트 |
| `OCR_BUDGET` | 70000 chars | main.mjs:2955 | RAG 컨텍스트 OCR 예산 |
| `TOTAL_BUDGET` | 120000 chars | main.mjs:2957 | RAG 컨텍스트 전체 예산 |

## IPC 핸들러 목록

### Renderer → Main (ipcMain.handle)
| 채널 | 줄 | 설명 |
|------|------|------|
| `db:query` | 2064 | Supabase SELECT 프록시 (테이블 화이트리스트) |
| `db:mutate` | 2096 | Supabase INSERT/UPDATE/DELETE 프록시 |
| `file:import-pdf` | 2125 | PDF 임포트 (복사 + DB 등록 + 큐) |
| `file:inspect-pdf` | 2170 | PDF 메타데이터 미리보기 |
| `file:get-path` | 2182 | 저장 경로 반환 |
| `file:open-path` | 2194 | 파일 열기 |
| `file:delete` | 2207 | 파일 삭제 |
| `file:open-in-explorer` | 2217 | 탐색기에서 열기 |
| `file:select-dialog` | 2227 | 파일 선택 다이얼로그 |
| `app:get-platform` | 2250 | OS 플랫폼 |
| `app:get-version` | 2251 | 앱 버전 |
| `app:get-library-path` | 2252 | 라이브러리 경로 |
| `window:detach-panel` | 2258 | 패널 분리 |
| `window:reattach-panel` | 2310 | 패널 복원 |
| `window:minimize/maximize/close` | 2319-2335 | 윈도우 제어 |
| `backup:create` | 2339 | 백업 생성 |
| `backup:list` | 2391 | 백업 목록 |
| `backup:restore` | 2404 | 백업 복원 |
| `auth:google-sign-in` | 2444 | Google OAuth |
| `embedding:generate-query` | 2468 | 쿼리 임베딩 생성 |
| `pipeline:requeue-all` | 2477 | 전체 재처리 큐 |
| `chat:send-message` | 3315 | 채팅 메시지 (테이블/Q&A) |
| `chat:abort` | 3879 | 채팅 중단 |
| `chat:export-csv` | 3889 | CSV 내보내기 |
| `llm:list-models` | 3939 | Ollama 모델 목록 |
| `llm:get-model` | 3960 | 현재 모델 조회 |
| `llm:set-model` | 3981 | 모델 변경 |

### Main → Renderer (webContents.send)
| 이벤트 | 설명 |
|--------|------|
| `job:progress` | 작업 진행률 |
| `job:completed` | 작업 완료 |
| `job:failed` | 작업 실패 |
| `chat:token` | LLM 토큰 스트리밍 |
| `chat:complete` | 채팅 완료 |
| `chat:error` | 채팅 에러 |
| `chat:status` | 파이프라인 단계 상태 |
| `chat:verification-done` | Guardian 검증 완료 |

## DB 테이블 화이트리스트
- `DB_QUERY_TABLES`: 23개 테이블 (main.mjs:99-124)
- `DB_MUTATE_TABLES`: 22개 테이블 (main.mjs:125-149)
- 테이블 추가 시 반드시 양쪽 갱신 필요

## 앱 라이프사이클
1. `app.whenReady()` → `createMainWindow()`
2. `resetStaleRunningJobs()` — running 상태 작업 → queued 리셋
3. `reprocessOutdatedPapers()` — extraction_version < 24인 논문 재큐
4. `startProcessingLoop()` — 2.5초 간격 폴링 시작
5. LLM 모델 로드: `user_workspace_preferences.llm_model` → `setActiveModel()`

## 의존성
- 사용: supabase, embedding-worker, pdf-heuristics, ocr-extraction, mineru-client, grobid-client, llm-chat, llm-orchestrator, llm-qa, html-table-parser, reranker-worker
- 사용됨: preload.mjs (renderer bridge)

## 현재 상태
- 구현 완료: 전체 IPC, PDF 파이프라인 V1/V2, 채팅 테이블/Q&A, Guardian, 모델 선택
- 알려진 이슈: ROADMAP에 chat Supabase null 처리 수정 계획됨
