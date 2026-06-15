# Fix: Orchestrator에 실제 테이블 캡션 전달 → N/A 감소

> 작성일: 2026-04-22 | 유형: 버그/품질 개선 | 규모: 소규모 (2파일, DB 변경 없음)

## 문제 (데이터 기반)

`chat_generated_tables` 쿼리 결과:
- `R²` 열: 100% N/A (57행 전부) — 논문에 등온선 R² 값이 아예 없음 (DB 확인)
- `P (kPa)`, `q_e` 열: 49% N/A — 일부 논문만 해당 값 보고

**근본 원인**: Orchestrator가 논문 제목/저자/연도만 보고 `column_definitions`를 일반 지식으로 추측한다.
논문에 실제로 어떤 파라미터 테이블이 있는지 모르므로 없는 열(R²)을 생성한다.

**확인된 사실**: DB에 26개 테이블 캡션이 있으며 `R²`는 어떤 캡션에도 등장하지 않음.
캡션을 Orchestrator에 전달하면 추측 없이 실제 있는 파라미터만 column_definitions에 넣을 수 있다.

## 변경 범위

| 파일 | 변경 내용 |
|------|-----------|
| `apps/desktop/electron/main.mjs` | Orchestrator 호출 전 `figures` 테이블에서 캡션 조회 후 전달 |
| `apps/desktop/electron/llm-orchestrator.mjs` | `generateOrchestratorPlan` 파라미터 추가 + 시스템 프롬프트 업데이트 |

## 구체적 변경

### 1. main.mjs — 테이블 캡션 조회 및 전달

**위치**: line ~2816, `allPapers` 조회 직후

```js
// [기존]
const { data: allPapers } = await supabase.from("papers").select("id, title, authors, publication_year");
const paperList = ...;

// [추가] 논문별 테이블 캡션 조회 (figure_no + caption만, HTML 제외)
const paperIdsForCaptions = (allPapers ?? []).map((p) => p.id);
const { data: tableFigs } = await supabase
  .from("figures")
  .select("paper_id, figure_no, caption")
  .eq("item_type", "table")
  .in("paper_id", paperIdsForCaptions);

// 논문별 캡션 맵 (paperId → [{figure_no, caption}])
const captionsByPaper = new Map();
for (const f of tableFigs ?? []) {
  if (!captionsByPaper.has(f.paper_id)) captionsByPaper.set(f.paper_id, []);
  captionsByPaper.get(f.paper_id).push({ figureNo: f.figure_no, caption: f.caption });
}

// paperList에 tableCaptions 병합
const paperListWithCaptions = (allPapers ?? []).map((p) => ({
  title: p.title ?? "Untitled",
  authors: Array.isArray(p.authors) ? p.authors.map((a) => a.family ?? a.name ?? "").join(", ") : "",
  year: p.publication_year ?? 0,
  tableCaptions: captionsByPaper.get(p.id) ?? [],
}));
```

**위치**: line 2836, `generateOrchestratorPlan` 호출

```js
// [기존]
const plan = await generateOrchestratorPlan(history, paperList, previousTable, abortController.signal);

// [변경]
const plan = await generateOrchestratorPlan(history, paperListWithCaptions, previousTable, abortController.signal);
```

### 2. llm-orchestrator.mjs — 시그니처 + 프롬프트 업데이트

**`generateOrchestratorPlan` 함수**: `paperList` 내 `tableCaptions` 배열을 읽어 시스템 프롬프트에 추가.

```js
// [기존] paperList 섹션
const list = paperList
  .map((p, i) => `${i + 1}. ${p.title} — ${p.authors || "N/A"} (${p.year || "N/A"})`)
  .join("\n");
systemContent += `\n\n=== 사용자의 논문 목록 (${paperList.length}편) ===\n${list}`;

// [변경] 테이블 캡션 포함
const list = paperList.map((p, i) => {
  let line = `${i + 1}. ${p.title} — ${p.authors || "N/A"} (${p.year || "N/A"})`;
  if (p.tableCaptions && p.tableCaptions.length > 0) {
    const caps = p.tableCaptions
      .map((c) => `   - ${c.figureNo}: ${c.caption?.slice(0, 120) ?? ""}`)
      .join("\n");
    line += `\n${caps}`;
  }
  return line;
}).join("\n");
systemContent += `\n\n=== 사용자의 논문 목록 (${paperList.length}편, 실제 테이블 목록 포함) ===\n${list}`;
```

**시스템 프롬프트 지침 추가** (column_definitions 설계 규칙 섹션):

```
6. **반드시 위 논문 목록의 실제 테이블 캡션을 확인하세요.** 캡션에 없는 파라미터를 
   column_definitions에 추가하지 마세요. 예: 캡션에 R²가 없으면 R² 열을 만들지 않음.
```

## 검증 기준

1. `node --check apps/desktop/electron/main.mjs` 통과
2. `node --check apps/desktop/electron/llm-orchestrator.mjs` 통과
3. Orchestrator 로그에서 테이블 캡션이 전달되는지 확인 (시스템 프롬프트 출력)

## 기대 효과

- 현재 R² 100% N/A → 논문에 없는 열이므로 Orchestrator가 column_definitions에서 제외
- column_definitions가 실제 논문 파라미터와 일치 → N/A 전반적 감소
