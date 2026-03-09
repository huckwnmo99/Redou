# Redou

Windows 기반 연구자용 논문 정리 및 확장형 연구 지원 앱의 초기 구축 저장소입니다.

## Repository Structure

- `apps/desktop`
  - 실제 데스크톱 앱 코드 시작점
- `docs/planning`
  - 제품 정의, 구현 계획, annotation 관련 문서
- `docs/frontend`
  - 프론트엔드 옵션 및 구조 문서
- `docs/database`
  - 데이터베이스 설계 초안
- `prototypes`
  - 디자인 시안과 HTML 프로토타입

## Current Build Direction

- 앱 타입: `Electron + React + TypeScript`
- 선택 디자인 기준: `21_reference_collector`
- 현재 범위: 카테고리 트리, 라이브러리, 논문 상세, 리더/노트, 검색, 설정의 앱 셸 구축

## First Working Area

- 메인 앱 시작점: `apps/desktop`
- 현재 구현 단계에서는 mock data 기반 UI 셸부터 구축
- 이후 순서:
  1. local Supabase 연결
  2. PDF/OCR ingestion
  3. annotation persistence
  4. vector generation + 요약 파이프라인

