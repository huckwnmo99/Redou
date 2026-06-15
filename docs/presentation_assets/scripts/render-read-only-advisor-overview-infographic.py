from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "presentation_assets" / "read-only-improvement-advisor-overview-infographic.png"

W, H = 1920, 1080
NAVY = "#002060"
DEEP = "#011A61"
INK = "#0B122E"
PANEL = "#102A5C"
PANEL_2 = "#14366F"
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


def wrap(draw, text, fnt, max_width):
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
        if current:
            lines.append(current)
    return lines


def text(draw, value, xy, fnt, fill=WHITE, max_width=None, line_gap=8, anchor=None):
    if max_width is None:
        draw.text(xy, value, font=fnt, fill=fill, anchor=anchor)
        return
    x, y = xy
    for line in wrap(draw, value, fnt, max_width):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap


def rounded(draw, box, fill, outline=None, width=2, radius=28):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline or fill, width=width)


def arrow(draw, start, end, fill=MINT, width=6):
    x1, y1 = start
    x2, y2 = end
    draw.line((x1, y1, x2, y2), fill=fill, width=width)
    if x2 >= x1:
        pts = [(x2, y2), (x2 - 22, y2 - 13), (x2 - 22, y2 + 13)]
    else:
        pts = [(x2, y2), (x2 + 22, y2 - 13), (x2 + 22, y2 + 13)]
    draw.polygon(pts, fill=fill)


def pill(draw, box, label, fill):
    rounded(draw, box, fill, fill, width=1, radius=16)
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    draw.text((cx, cy), label, font=font(20, True), fill=INK, anchor="mm")


def icon_papers(draw, cx, cy, scale=1.0):
    w, h = 82 * scale, 105 * scale
    for off, color in [(18, "#B8D5FF"), (9, "#D8E8FF"), (0, WHITE)]:
        x = cx - w / 2 + off * scale
        y = cy - h / 2 - off * 0.25 * scale
        rounded(draw, (x, y, x + w, y + h), color, "#D7E6FF", width=2, radius=int(8 * scale))
        draw.line((x + 18 * scale, y + 32 * scale, x + 62 * scale, y + 32 * scale), fill=NAVY, width=max(1, int(3 * scale)))
        draw.line((x + 18 * scale, y + 50 * scale, x + 66 * scale, y + 50 * scale), fill=NAVY, width=max(1, int(3 * scale)))


def icon_snapshot(draw, cx, cy, scale=1.0):
    rounded(draw, (cx - 52 * scale, cy - 56 * scale, cx + 52 * scale, cy + 56 * scale), WHITE, "#D7E6FF", 2, int(12 * scale))
    for i, color in enumerate([CYAN, MINT, AMBER]):
        y = cy - 28 * scale + i * 28 * scale
        draw.ellipse((cx - 30 * scale, y - 8 * scale, cx - 14 * scale, y + 8 * scale), fill=color)
        draw.line((cx - 4 * scale, y, cx + 32 * scale, y), fill=NAVY, width=max(1, int(4 * scale)))


def icon_rules(draw, cx, cy, scale=1.0):
    draw.ellipse((cx - 60 * scale, cy - 60 * scale, cx + 60 * scale, cy + 60 * scale), fill=WHITE, outline="#D7E6FF", width=2)
    for i in range(6):
        angle = i * 60
        x = cx + 42 * scale
        y = cy
        draw.ellipse((x - 9 * scale, y - 9 * scale, x + 9 * scale, y + 9 * scale), fill=MINT)
    draw.line((cx - 35 * scale, cy, cx + 35 * scale, cy), fill=NAVY, width=max(1, int(5 * scale)))
    draw.line((cx, cy - 35 * scale, cx, cy + 35 * scale), fill=NAVY, width=max(1, int(5 * scale)))


def icon_llm(draw, cx, cy, scale=1.0):
    rounded(draw, (cx - 70 * scale, cy - 38 * scale, cx + 28 * scale, cy + 36 * scale), WHITE, "#D7E6FF", 2, int(28 * scale))
    rounded(draw, (cx - 18 * scale, cy - 55 * scale, cx + 76 * scale, cy + 18 * scale), "#D9F8F2", "#BEEFE5", 2, int(28 * scale))
    draw.text((cx - 20 * scale, cy - 5 * scale), "A", font=font(int(34 * scale), True), fill=NAVY, anchor="mm")
    draw.text((cx + 30 * scale, cy - 18 * scale), "B", font=font(int(34 * scale), True), fill=NAVY, anchor="mm")
    draw.line((cx + 2 * scale, cy - 2 * scale, cx + 15 * scale, cy - 12 * scale), fill=MINT, width=max(1, int(5 * scale)))


def icon_cards(draw, cx, cy, scale=1.0):
    for i, color in enumerate([CYAN, MINT, AMBER]):
        x = cx - 64 * scale + i * 34 * scale
        y = cy - 48 * scale + i * 10 * scale
        rounded(draw, (x, y, x + 92 * scale, y + 90 * scale), color, color, 1, int(12 * scale))
        draw.line((x + 16 * scale, y + 28 * scale, x + 72 * scale, y + 28 * scale), fill=INK, width=max(1, int(4 * scale)))
        draw.line((x + 16 * scale, y + 48 * scale, x + 64 * scale, y + 48 * scale), fill=INK, width=max(1, int(4 * scale)))


def icon_user(draw, cx, cy, scale=1.0):
    draw.ellipse((cx - 34 * scale, cy - 64 * scale, cx + 34 * scale, cy + 4 * scale), fill=WHITE)
    rounded(draw, (cx - 78 * scale, cy + 14 * scale, cx + 78 * scale, cy + 74 * scale), WHITE, WHITE, 1, int(35 * scale))
    draw.line((cx - 28 * scale, cy + 40 * scale, cx - 5 * scale, cy + 62 * scale), fill=MINT, width=max(1, int(9 * scale)))
    draw.line((cx - 5 * scale, cy + 62 * scale, cx + 42 * scale, cy + 20 * scale), fill=MINT, width=max(1, int(9 * scale)))


def node(draw, box, number, heading, desc, accent, icon_fn):
    x1, y1, x2, y2 = box
    rounded(draw, box, PANEL, accent, width=3, radius=30)
    pill(draw, (x1 + 28, y1 + 26, x1 + 84, y1 + 66), number, accent)
    icon_fn(draw, x1 + 120, y1 + 133, 0.72)
    text(draw, heading, (x1 + 205, y1 + 82), font(30, True), WHITE)
    text(draw, desc, (x1 + 205, y1 + 128), font(21), PALE, max_width=x2 - x1 - 245, line_gap=7)


img = Image.new("RGB", (W, H), NAVY)
draw = ImageDraw.Draw(img)
draw.rectangle((0, 0, W, H), fill=NAVY)
draw.rectangle((0, 0, W, H), fill=INK)

glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((1260, -220, 2160, 620), fill=(99, 179, 255, 40))
gd.ellipse((-240, 710, 600, 1350), fill=(77, 231, 200, 38))
img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(42))).convert("RGB")
draw = ImageDraw.Draw(img)

draw.text((92, 68), "전체 오버뷰", font=font(28, True), fill=MINT)
draw.text((92, 112), "Redou Read-only Improvement Advisor", font=font(58, True), fill=WHITE)
text(draw, "연구 작업공간을 먼저 읽고, 규칙 기반으로 약한 지점을 찾은 뒤, LLM 협력으로 설명과 검토를 보강하는 안전한 자가개선 흐름", (96, 188), font(27), PALE, max_width=1320, line_gap=8)
draw.line((96, 270, 290, 270), fill=MINT, width=6)

node(draw, (88, 340, 595, 555), "1", "Research Workspace", "PDF, 처리 작업, 검색 조각, 표, 폴더 상태", CYAN, icon_papers)
node(draw, (708, 340, 1215, 555), "2", "Workspace Snapshot", "본문이 아니라 상태 신호만 요약", MINT, icon_snapshot)
node(draw, (1328, 340, 1835, 555), "3", "Rule Analyzer", "근거 있는 개선 후보를 deterministic하게 탐지", CYAN, icon_rules)

node(draw, (260, 705, 760, 920), "4", "LLM Cooperation", "Writer가 쉽게 설명하고 Reviewer가 과장과 오류를 점검", AMBER, icon_llm)
node(draw, (890, 705, 1390, 920), "5", "Suggestion Cards", "문제, 근거, 중요성, 추천 행동, 위험도", MINT, icon_cards)
node(draw, (1505, 705, 1835, 920), "6", "User Approval", "사용자가 승인해야 다음 행동으로 진행", AMBER, icon_user)

arrow(draw, (605, 448), (695, 448), MINT)
arrow(draw, (1225, 448), (1315, 448), MINT)
arrow(draw, (1576, 568), (585, 692), CYAN, width=5)
arrow(draw, (770, 812), (878, 812), MINT)
arrow(draw, (1402, 812), (1492, 812), MINT)

rounded(draw, (88, 960, 1835, 1010), PANEL_2, "#2F65B7", width=2, radius=20)
text(draw, "핵심 원칙: 자동 수정은 나중 문제입니다. MVP는 읽기 전용 진단과 근거 있는 제안으로 시작합니다.", (120, 975), font(25, True), WHITE)

draw.text((92, 1038), "Redou / Read-only Improvement Advisor overview infographic", font=font(15), fill=SOFT)
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT)
print(f"wrote {OUT}")
