from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "presentation_assets" / "read-only-improvement-advisor-preview"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1600, 900
NAVY = "#002060"
DEEP = "#011A61"
INK = "#0B122E"
PALE = "#E2ECFB"
WHITE = "#FFFFFF"
MINT = "#4DE7C8"
CYAN = "#63B3FF"
AMBER = "#F4C95D"
RED = "#EF6B73"
SOFT = "#B9C8E8"

FONT = Path("C:/Windows/Fonts/malgun.ttf")
BOLD = Path("C:/Windows/Fonts/malgunbd.ttf")


def font(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), size)


def wrap_text(draw, text, fnt, max_width):
    lines = []
    for raw in text.split("\n"):
        current = ""
        for ch in raw:
            test = current + ch
            if draw.textbbox((0, 0), test, font=fnt)[2] <= max_width:
                current = test
            else:
                if current:
                    lines.append(current)
                current = ch
        lines.append(current)
    return lines


def draw_wrapped(draw, text, xy, max_width, fnt, fill, line_gap=8):
    x, y = xy
    for line in wrap_text(draw, text, fnt, max_width):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap


def bg(draw, index):
    draw.rectangle((0, 0, W, H), fill=NAVY)
    draw.rectangle((0, 0, W, H), fill=INK + "CC")
    draw.arc((1180, -110, 1760, 470), 50, 285, fill=CYAN, width=4)
    draw.arc((-180, 600, 420, 1200), 200, 60, fill=MINT, width=3)
    draw.text((1440, 38), f"{index:02d}", font=font(14, True), fill=SOFT)


def title(draw, title_text, sub=None):
    draw.text((86, 54), title_text, font=font(38, True), fill=WHITE)
    if sub:
        draw_wrapped(draw, sub, (90, 132), 1050, font(19), PALE, 5)
    draw.line((90, 205, 252, 205), fill=MINT, width=5)


def panel(draw, box, outline=CYAN):
    draw.rounded_rectangle(box, radius=20, fill="#102A5C", outline=outline, width=2)


def pill(draw, box, text, fill):
    draw.rounded_rectangle(box, radius=12, fill=fill, outline=fill, width=1)
    tw = draw.textbbox((0, 0), text, font=font(16, True))[2]
    draw.text((box[0] + (box[2] - box[0] - tw) / 2, box[1] + 9), text, font=font(16, True), fill=INK)


def footer(draw):
    draw.text((86, 848), "Redou / Read-only Improvement Advisor", font=font(12), fill=SOFT)


def save(img, idx):
    img.save(OUT / f"slide-{idx:02d}.png")


def slide_base(idx, heading=None, sub=None):
    img = Image.new("RGB", (W, H), NAVY)
    draw = ImageDraw.Draw(img)
    bg(draw, idx)
    if heading:
        title(draw, heading, sub)
    footer(draw)
    return img, draw


img, d = slide_base(1)
d.text((96, 68), "Redou", font=font(23, True), fill=PALE)
draw_wrapped(d, "스스로 약한 지점을\n찾는 연구 작업공간", (96, 182), 920, font(58, True), WHITE, 12)
d.text((100, 405), "Read-only Improvement Advisor", font=font(31, True), fill=MINT)
draw_wrapped(d, "자동 수정이 아니라, 현재 상태를 읽고 근거 있는 개선 후보를 제안하는 방식", (100, 468), 890, font(27), PALE, 8)
panel(d, (1015, 240, 1450, 570), MINT)
for i, txt in enumerate(["읽기만 한다", "근거를 만든다", "사용자가 선택한다"]):
    d.text((1070, 295 + i * 78), txt, font=font(30, True), fill=WHITE)
save(img, 1)

overview = ROOT / "docs" / "presentation_assets" / "read-only-improvement-advisor-overview-infographic.png"
if overview.exists():
    Image.open(overview).resize((W, H), Image.Resampling.LANCZOS).save(OUT / "slide-02.png")

img, d = slide_base(3, "왜 읽기 전용 방식을 택했나", "연구 데이터는 조심스럽게 다뤄야 하므로, 진단과 제안을 먼저 분리합니다.")
panel(d, (105, 260, 700, 690), RED)
panel(d, (895, 260, 1490, 690), MINT)
d.text((145, 300), "처음부터 자동 수정", font=font(32, True), fill=WHITE)
draw_wrapped(d, "잘못된 판단이 논문 상태를 바꿀 수 있음\n사용 기록을 많이 모으면 부담이 커짐\n왜 고쳤는지 설명하기 어려워짐", (150, 385), 500, font(24), PALE, 10)
d.text((940, 300), "읽기 전용 진단", font=font(32, True), fill=WHITE)
draw_wrapped(d, "기존 상태만 보고 시작 가능\n제안마다 근거를 함께 표시\n사용자 승인 전에는 아무것도 바꾸지 않음", (945, 385), 500, font(24), PALE, 10)
d.line((725, 470, 855, 470), fill=MINT, width=5)
d.polygon([(855, 470), (832, 456), (832, 484)], fill=MINT)
save(img, 3)

img, d = slide_base(4, "설명: 규칙 분석과 LLM 협력 구조", "판단의 출발점은 규칙 analyzer가 잡고, LLM은 설명 작성과 리뷰를 맡습니다.")
for i, (h, b, c) in enumerate([
    ("Snapshot", "현재 상태만 요약\n본문/노트 전문 제외", CYAN),
    ("Rule Analyzer", "근거 있는 문제 후보\n규칙 기반 탐지", CYAN),
    ("LLM Writer", "사용자가 이해할\n설명 문장 작성", MINT),
    ("LLM Reviewer", "과장/오해/근거 불일치\n한 번 더 검토", MINT),
]):
    x = 86 + i * 372
    panel(d, (x, 285, x + 292, 555), c)
    d.text((x + 24, 328), h, font=font(27, True), fill=WHITE)
    draw_wrapped(d, b, (x + 25, 405), 235, font(21), PALE, 7)
    if i < 3:
        d.line((x + 304, 420, x + 352, 420), fill=MINT, width=5)
        d.polygon([(x + 352, 420), (x + 332, 407), (x + 332, 433)], fill=MINT)
panel(d, (120, 638, 1450, 748), AMBER)
draw_wrapped(d, "핵심: LLM이 진단을 시작하지 않습니다. 규칙 analyzer가 만든 근거를 LLM들이 설명하고 검토합니다.", (160, 676), 1240, font(24, True), WHITE, 6)
save(img, 4)


def examples(idx, heading, sub, left, right):
    img, d = slide_base(idx, heading, sub)
    for j, ex in enumerate([left, right]):
        x = 105 if j == 0 else 825
        color = CYAN if j == 0 else MINT
        panel(d, (x, 260, x + 660, 725), color)
        pill(d, (x + 40, 300, x + 210, 346), ex[0], color)
        d.text((x + 42, 375), ex[1], font=font(29, True), fill=WHITE)
        y = 455
        for label, body in [("상황", ex[2]), ("근거", ex[3]), ("제안", ex[4])]:
            d.text((x + 42, y), label, font=font(18, True), fill=color)
            draw_wrapped(d, body, (x + 125, y - 4), 480, font(21), WHITE if label == "제안" else PALE, 6)
            y += 78
    save(img, idx)


examples(5, "예시 1-2: 처리와 검색", "멈춘 처리와 검색 준비도는 가장 먼저 드러나는 자가진단 신호입니다.",
         ("예시 1", "PDF 처리가 멈춘 경우", "queued/running 상태가 오래 남아 있음", "오래된 처리 작업 수, 실패 반복 그룹", "재처리 또는 실패 원인 확인 화면을 먼저 만든다"),
         ("예시 2", "검색 데이터가 부족한 경우", "논문은 있지만 chunk 또는 embedding이 없음", "chunk 없는 논문 수, embedding 없는 chunk 수", "검색 품질 개선 전 embedding 누락을 확인한다"))
examples(6, "예시 3-4: 추출과 표", "검색과 표 생성의 품질은 PDF 추출과 근거 계약에서 결정됩니다.",
         ("예시 3", "논문 구조 추출이 빈약한 경우", "section, caption, page hint가 충분하지 않음", "section 없는 논문, caption 없는 figure", "검색 확장 전 PDF 추출 완성도를 점검한다"),
         ("예시 4", "생성된 표의 근거가 약한 경우", "빈 칸, fallback, 미검증 셀이 많음", "빈 셀 비율, source ref 없는 표 수", "표 자동화 확장 전 근거 부족 패턴을 확인한다"))
examples(7, "예시 5-6: 라이브러리 정리", "연구 자료의 작은 정리 문제도 나중에는 검색과 자동화 품질에 영향을 줍니다.",
         ("예시 5", "기본 정보가 부족한 경우", "폴더, 제목, 연도, 저자 정보가 비어 있음", "폴더 없는 논문 수, metadata 부족 논문 수", "기본 metadata와 폴더 정리 후보를 보여준다"),
         ("예시 6", "중복 후보나 빈 폴더가 있는 경우", "같은 제목/연도 조합 또는 빈 폴더가 있음", "중복 그룹 수, 빈 폴더 수", "자동 정리 전 검토 목록으로만 제시한다"))

img, d = slide_base(8, "현재 상태와 다음 단계", "지금은 화면 기능이 아니라, 제안을 만들 수 있는 분석 엔진까지 준비된 상태입니다.")
for i, (head, body, color) in enumerate([
    ("완료", "Snapshot 형식\nAnalyzer\n5개 영역 제안\n테스트/빌드 확인", MINT),
    ("다음", "기존 앱 데이터 연결\nSettings 카드 표시\n사용자 반응 확인", CYAN),
    ("이후", "LLM Writer/Reviewer\n제안 문장 품질 개선\n승인 기반 자동화", AMBER),
]):
    x = 115 + i * 485
    panel(d, (x, 295, x + 400, 670), color)
    pill(d, (x + 38, 335, x + 178, 380), head, color)
    draw_wrapped(d, body, (x + 44, 425), 300, font(29, True), WHITE, 10)
    if i < 2:
        d.line((x + 415, 475, x + 465, 475), fill=MINT, width=5)
        d.polygon([(x + 465, 475), (x + 445, 462), (x + 445, 488)], fill=MINT)
d.text((120, 742), "방향: 한 번에 똑똑한 자동화를 만들기보다, 먼저 믿을 수 있는 제안을 만든다.", font=font(27, True), fill=WHITE)
save(img, 8)

print(f"wrote {OUT}")
