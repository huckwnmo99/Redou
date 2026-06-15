const fs = require("fs");
const path = require("path");
require("module").Module._initPaths();

const pptxgen = require("pptxgenjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OUTPUT = path.join(ROOT, "ppt", "read-only-improvement-advisor.pptx");
const INFOGRAPHIC = path.join(ROOT, "docs", "presentation_assets", "read-only-improvement-advisor-overview-infographic.png");

const pptx = new pptxgen();
pptx.author = "Redou";
pptx.company = "Redou";
pptx.subject = "Read-only Improvement Advisor";
pptx.title = "Read-only Improvement Advisor";
pptx.lang = "ko-KR";
pptx.layout = "LAYOUT_WIDE";
pptx.theme = {
  headFontFace: "Malgun Gothic",
  bodyFontFace: "Malgun Gothic",
  lang: "ko-KR",
};
pptx.defineLayout({ name: "REDOU_WIDE", width: 13.333, height: 7.5 });
pptx.layout = "REDOU_WIDE";

const C = {
  navy: "002060",
  deep: "011A61",
  ink: "0B122E",
  slate: "26364F",
  pale: "E2ECFB",
  white: "FFFFFF",
  mint: "4DE7C8",
  cyan: "63B3FF",
  amber: "F4C95D",
  red: "EF6B73",
  soft: "B9C8E8",
  gray: "414141",
};

const W = 13.333;
const H = 7.5;
const FONT = "Malgun Gothic";

function addBg(slide, index) {
  slide.background = { color: C.navy };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: C.navy },
    line: { color: C.navy },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: C.ink, transparency: 22 },
    line: { color: C.ink, transparency: 100 },
  });
  slide.addShape(pptx.ShapeType.arc, {
    x: 9.9,
    y: -1.0,
    w: 4.8,
    h: 4.8,
    adjustPoint: 0.23,
    rotate: 25,
    line: { color: C.cyan, transparency: 35, width: 2 },
  });
  slide.addShape(pptx.ShapeType.arc, {
    x: -1.3,
    y: 4.9,
    w: 4.0,
    h: 4.0,
    adjustPoint: 0.28,
    rotate: 210,
    line: { color: C.mint, transparency: 50, width: 1.4 },
  });
  slide.addText(String(index).padStart(2, "0"), {
    x: 11.95,
    y: 0.33,
    w: 0.65,
    h: 0.25,
    fontFace: FONT,
    fontSize: 8,
    color: C.soft,
    bold: true,
    align: "right",
    margin: 0,
    breakLine: false,
  });
}

function title(slide, text, sub) {
  slide.addText(text, {
    x: 0.72,
    y: 0.45,
    w: 9.2,
    h: 0.72,
    fontFace: FONT,
    fontSize: 28,
    bold: true,
    color: C.white,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.75,
      y: 1.18,
      w: 8.9,
      h: 0.34,
      fontFace: FONT,
      fontSize: 12.5,
      color: C.pale,
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
  }
  slide.addShape(pptx.ShapeType.line, {
    x: 0.75,
    y: 1.68,
    w: 1.35,
    h: 0,
    line: { color: C.mint, width: 2.2 },
  });
}

function footer(slide) {
  slide.addText("Redou / Read-only Improvement Advisor", {
    x: 0.72,
    y: 7.06,
    w: 3.8,
    h: 0.18,
    fontFace: FONT,
    fontSize: 6.7,
    color: C.soft,
    margin: 0,
    breakLine: false,
  });
}

function pill(slide, text, x, y, w, color = C.mint) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.34,
    rectRadius: 0.07,
    fill: { color, transparency: 10 },
    line: { color, transparency: 0, width: 0.8 },
  });
  slide.addText(text, {
    x: x + 0.12,
    y: y + 0.075,
    w: w - 0.24,
    h: 0.18,
    fontFace: FONT,
    fontSize: 7.6,
    color: C.ink,
    bold: true,
    align: "center",
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
}

function panel(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.13,
    fill: { color: opts.fill || C.deep, transparency: opts.transparency ?? 8 },
    line: { color: opts.line || C.pale, transparency: opts.lineTransparency ?? 75, width: 0.8 },
  });
}

function bodyText(slide, text, x, y, w, h, size = 14, color = C.pale, bold = false) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: FONT,
    fontSize: size,
    color,
    bold,
    margin: 0,
    breakLine: false,
    fit: "shrink",
    valign: "mid",
  });
}

function arrow(slide, x1, y1, x2, y2, color = C.mint) {
  slide.addShape(pptx.ShapeType.line, {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: { color, width: 2.2, beginArrowType: "none", endArrowType: "triangle" },
  });
}

function slide1() {
  const slide = pptx.addSlide();
  addBg(slide, 1);
  slide.addText("Redou", {
    x: 0.8,
    y: 0.55,
    w: 1.6,
    h: 0.38,
    fontFace: FONT,
    fontSize: 12,
    color: C.pale,
    bold: true,
    margin: 0,
  });
  slide.addText("스스로 약한 지점을\n찾는 연구 작업공간", {
    x: 0.78,
    y: 1.52,
    w: 8.9,
    h: 1.65,
    fontFace: FONT,
    fontSize: 33,
    bold: true,
    color: C.white,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  slide.addText("Read-only Improvement Advisor", {
    x: 0.82,
    y: 3.38,
    w: 5.2,
    h: 0.34,
    fontFace: FONT,
    fontSize: 16,
    color: C.mint,
    bold: true,
    margin: 0,
    breakLine: false,
  });
  slide.addText("자동 수정이 아니라, 현재 상태를 읽고 근거 있는 개선 후보를 제안하는 방식", {
    x: 0.82,
    y: 3.9,
    w: 7.4,
    h: 0.55,
    fontFace: FONT,
    fontSize: 15,
    color: C.pale,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  panel(slide, 8.55, 2.0, 3.55, 2.75, { transparency: 0, line: C.mint, lineTransparency: 25 });
  bodyText(slide, "읽기만 한다", 9.0, 2.46, 2.5, 0.35, 18, C.white, true);
  bodyText(slide, "근거를 만든다", 9.0, 3.1, 2.5, 0.35, 18, C.white, true);
  bodyText(slide, "사용자가 선택한다", 9.0, 3.75, 2.75, 0.35, 18, C.white, true);
  slide.addShape(pptx.ShapeType.line, { x: 8.94, y: 2.92, w: 2.45, h: 0, line: { color: C.cyan, width: 1 } });
  slide.addShape(pptx.ShapeType.line, { x: 8.94, y: 3.57, w: 2.45, h: 0, line: { color: C.cyan, width: 1 } });
  footer(slide);
}

function slide2() {
  const slide = pptx.addSlide();
  addBg(slide, 3);
  title(slide, "왜 읽기 전용 방식을 택했나", "연구 데이터는 조심스럽게 다뤄야 하므로, 진단과 제안을 먼저 분리합니다.");
  panel(slide, 0.85, 2.15, 5.0, 3.55, { fill: "1B2B58", line: C.red, lineTransparency: 20 });
  panel(slide, 7.48, 2.15, 5.0, 3.55, { fill: "102A5C", line: C.mint, lineTransparency: 15 });
  bodyText(slide, "처음부터 자동 수정", 1.2, 2.48, 4.2, 0.35, 19, C.white, true);
  bodyText(slide, "잘못된 판단이 논문 상태를 바꿀 수 있음\n사용 기록을 많이 모으면 부담이 커짐\n왜 고쳤는지 설명하기 어려워짐", 1.25, 3.18, 4.15, 1.5, 14, C.pale);
  bodyText(slide, "읽기 전용 진단", 7.86, 2.48, 4.2, 0.35, 19, C.white, true);
  bodyText(slide, "기존 상태만 보고 시작 가능\n제안마다 근거를 함께 표시\n사용자 승인 전에는 아무것도 바꾸지 않음", 7.9, 3.18, 4.1, 1.5, 14, C.pale);
  slide.addText("선택", {
    x: 6.14,
    y: 3.55,
    w: 1.05,
    h: 0.36,
    fontFace: FONT,
    fontSize: 15,
    bold: true,
    color: C.mint,
    align: "center",
    margin: 0,
  });
  arrow(slide, 6.0, 3.75, 7.15, 3.75);
  footer(slide);
}

function slide3() {
  const slide = pptx.addSlide();
  addBg(slide, 4);
  title(slide, "설명: 규칙 분석과 LLM 협력 구조", "판단의 출발점은 규칙 analyzer가 잡고, LLM은 설명 작성과 리뷰를 맡습니다.");
  const items = [
    ["Snapshot", "현재 상태만 요약\n본문/노트 전문 제외"],
    ["Rule Analyzer", "근거 있는 문제 후보\n규칙 기반 탐지"],
    ["LLM Writer", "사용자가 이해할\n설명 문장 작성"],
    ["LLM Reviewer", "과장/오해/근거 불일치\n한 번 더 검토"],
  ];
  items.forEach(([head, desc], i) => {
    const x = 0.72 + i * 3.1;
    const line = i >= 2 ? C.mint : C.cyan;
    panel(slide, x, 2.35, 2.42, 2.26, { fill: i === 1 ? "102D64" : C.deep, line, lineTransparency: 30 });
    bodyText(slide, head, x + 0.2, 2.7, 2.0, 0.3, 15.4, C.white, true);
    bodyText(slide, desc, x + 0.22, 3.28, 1.95, 0.82, 10.8, C.pale);
    if (i < 3) arrow(slide, x + 2.5, 3.48, x + 2.88, 3.48, C.mint);
  });
  panel(slide, 1.0, 5.3, 11.1, 0.92, { fill: "082873", line: C.amber, lineTransparency: 25 });
  slide.addText("핵심: LLM이 진단을 시작하지 않습니다. 규칙 analyzer가 만든 근거를 LLM들이 설명하고 검토합니다.", {
    x: 1.34,
    y: 5.62,
    w: 10.3,
    h: 0.28,
    fontFace: FONT,
    fontSize: 12.6,
    color: C.white,
    bold: true,
    margin: 0,
    fit: "shrink",
  });
  footer(slide);
}

function exampleSlide(index, heading, subheading, examples) {
  const slide = pptx.addSlide();
  addBg(slide, index);
  title(slide, heading, subheading);
  examples.forEach((ex, i) => {
    const x = i === 0 ? 0.88 : 6.86;
    panel(slide, x, 2.18, 5.55, 3.92, { fill: i === 0 ? "122B58" : "142F62", line: i === 0 ? C.cyan : C.mint, lineTransparency: 28 });
    pill(slide, ex.badge, x + 0.34, 2.48, 1.45, ex.color);
    bodyText(slide, ex.title, x + 0.36, 2.98, 4.6, 0.36, 18, C.white, true);
    bodyText(slide, "상황", x + 0.36, 3.62, 0.9, 0.22, 9.5, ex.color, true);
    bodyText(slide, ex.situation, x + 1.05, 3.58, 4.35, 0.42, 11.5, C.pale);
    bodyText(slide, "근거", x + 0.36, 4.28, 0.9, 0.22, 9.5, ex.color, true);
    bodyText(slide, ex.evidence, x + 1.05, 4.22, 4.35, 0.58, 11.5, C.pale);
    bodyText(slide, "제안", x + 0.36, 5.07, 0.9, 0.22, 9.5, ex.color, true);
    bodyText(slide, ex.suggestion, x + 1.05, 5.0, 4.35, 0.55, 12.2, C.white, true);
  });
  footer(slide);
}

function slide7() {
  const slide = pptx.addSlide();
  addBg(slide, 8);
  title(slide, "현재 상태와 다음 단계", "지금은 화면 기능이 아니라, 제안을 만들 수 있는 분석 엔진까지 준비된 상태입니다.");
  const steps = [
    ["완료", "Snapshot 형식\nAnalyzer\n5개 영역 제안\n테스트/빌드 확인", C.mint],
    ["다음", "기존 앱 데이터 연결\nSettings 카드 표시\n사용자 반응 확인", C.cyan],
    ["이후", "LLM Writer/Reviewer\n제안 문장 품질 개선\n승인 기반 자동화", C.amber],
  ];
  steps.forEach(([head, body, color], i) => {
    const x = 0.95 + i * 4.05;
    panel(slide, x, 2.45, 3.35, 3.15, { fill: i === 0 ? "10335F" : "132A58", line: color, lineTransparency: 25 });
    pill(slide, head, x + 0.32, 2.78, 1.22, color);
    bodyText(slide, body, x + 0.38, 3.42, 2.55, 1.45, 15, C.white, true);
    if (i < 2) arrow(slide, x + 3.48, 4.0, x + 3.88, 4.0, C.mint);
  });
  slide.addText("방향: 한 번에 똑똑한 자동화를 만들기보다, 먼저 믿을 수 있는 제안을 만든다.", {
    x: 1.04,
    y: 6.18,
    w: 10.8,
    h: 0.42,
    fontFace: FONT,
    fontSize: 16,
    bold: true,
    color: C.white,
    margin: 0,
    fit: "shrink",
  });
  footer(slide);
}

slide1();
function slideOverview() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  if (!fs.existsSync(INFOGRAPHIC)) {
    throw new Error(`Missing infographic image: ${INFOGRAPHIC}`);
  }
  slide.addImage({
    path: INFOGRAPHIC,
    x: 0,
    y: 0,
    w: W,
    h: H,
  });
}

slideOverview();
slide2();
slide3();
exampleSlide(5, "예시 1-2: 처리와 검색", "멈춘 처리와 검색 준비도는 가장 먼저 드러나는 자가진단 신호입니다.", [
  {
    badge: "예시 1",
    color: C.cyan,
    title: "PDF 처리가 멈춘 경우",
    situation: "queued/running 상태가 오래 남아 있음",
    evidence: "오래된 처리 작업 수, 실패 반복 그룹",
    suggestion: "재처리 또는 실패 원인 확인 화면을 먼저 만든다",
  },
  {
    badge: "예시 2",
    color: C.mint,
    title: "검색 데이터가 부족한 경우",
    situation: "논문은 있지만 chunk 또는 embedding이 없음",
    evidence: "chunk 없는 논문 수, embedding 없는 chunk 수",
    suggestion: "검색 품질 개선 전 embedding 누락을 확인한다",
  },
]);
exampleSlide(6, "예시 3-4: 추출과 표", "검색과 표 생성의 품질은 PDF 추출과 근거 계약에서 결정됩니다.", [
  {
    badge: "예시 3",
    color: C.cyan,
    title: "논문 구조 추출이 빈약한 경우",
    situation: "section, caption, page hint가 충분하지 않음",
    evidence: "section 없는 논문, caption 없는 figure",
    suggestion: "검색 확장 전 PDF 추출 완성도를 점검한다",
  },
  {
    badge: "예시 4",
    color: C.mint,
    title: "생성된 표의 근거가 약한 경우",
    situation: "빈 칸, fallback, 미검증 셀이 많음",
    evidence: "빈 셀 비율, source ref 없는 표 수",
    suggestion: "표 자동화 확장 전 근거 부족 패턴을 확인한다",
  },
]);
exampleSlide(7, "예시 5-6: 라이브러리 정리", "자가개선은 거대한 AI 기능뿐 아니라, 연구 자료의 작은 정리 문제도 포착합니다.", [
  {
    badge: "예시 5",
    color: C.cyan,
    title: "기본 정보가 부족한 경우",
    situation: "폴더, 제목, 연도, 저자 정보가 비어 있음",
    evidence: "폴더 없는 논문 수, metadata 부족 논문 수",
    suggestion: "기본 metadata와 폴더 정리 후보를 보여준다",
  },
  {
    badge: "예시 6",
    color: C.mint,
    title: "중복 후보나 빈 폴더가 있는 경우",
    situation: "같은 제목/연도 조합 또는 빈 폴더가 있음",
    evidence: "중복 그룹 수, 빈 폴더 수",
    suggestion: "자동 정리 전 검토 목록으로만 제시한다",
  },
]);
slide7();

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
Promise.resolve(pptx.writeFile({ fileName: OUTPUT }))
  .then(() => {
    console.log(`wrote ${OUTPUT}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
