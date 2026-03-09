# Redou Implementation Plan

## Goal

기획 문서를 실제 앱으로 옮기기 위한 초기 구현 순서를 고정한다.

## Repository Layout

- `apps/desktop`
  - Electron renderer/app shell
  - 이후 local Supabase 연동 진입점
- `docs`
  - 제품, 프론트엔드, 데이터베이스 정책 문서
- `prototypes`
  - 디자인 검토 자산

## Initial Build Principles

- 먼저 `실제 UI 셸`을 만든다.
- PDF/OCR/LLM보다 `논문 관리 흐름`을 먼저 고정한다.
- 데이터는 초기에 mock data로 시작하고, 구조는 Supabase 테이블 초안에 맞춘다.
- 상위 카테고리와 하위 카테고리는 앱 구조의 중심으로 둔다.

## Phase 1

### Scope

- 앱 셸 구축
- 카테고리 트리 기반 라이브러리
- 논문 상세 화면
- 리더 + annotation 화면
- 검색 화면
- 설정/백업/휴지통 화면

### Deliverables

- `apps/desktop` 실행 구조
- 21번 스타일 기반 React 화면
- mock data 기반 카테고리 생성 흐름
- 초기 테스트 체크리스트

## Phase 2

### Scope

- local Supabase 연결
- auth 기본 구조
- category, paper, note, highlight 데이터 영속화

## Phase 3

### Scope

- PDF import
- OCR 파이프라인
- section / chunk / figure extraction 상태 저장

## Phase 4

### Scope

- highlight / note 저장
- PDF anchor / coordinate 저장
- category-linked paper organization

## Phase 5

### Scope

- vector 생성
- vector 생성 완료 이후 자동 요약
- 검색 결과와 근거 구조 정교화

## Immediate Next Steps

1. `apps/desktop` 앱 셸을 만든다.
2. 카테고리 생성과 화면 전환이 가능한 상태를 만든다.
3. 이후 local Supabase 연결을 위한 data layer를 분리한다.

