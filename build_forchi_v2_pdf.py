# Renders ForChi_V2_Blueprint.md -> a polished PDF in the Downloads folder.
import os, re
from reportlab.lib.pagesizes import letter
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    KeepTogether, HRFlowable, Preformatted
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT = r"C:\Users\hp\Downloads\ForChi_V2_Blueprint.pdf"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ForChi_V2_Blueprint.md")

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []
    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()
    def save(self):
        n = len(self._saved)
        for s in self._saved:
            self.__dict__.update(s)
            self._draw(n)
            super().showPage()
        super().save()
    def _draw(self, count):
        if self._pageNumber == 1:
            return
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#4A5568"))
        self.drawString(54, 750, "FORCHI v2 — UPDATED MASTER BLUEPRINT & BUILD SUMMARY")
        self.setStrokeColor(colors.HexColor("#CBD5E0"))
        self.setLineWidth(0.5)
        self.line(54, 742, 558, 742)
        self.line(54, 50, 558, 50)
        self.setFont("Helvetica", 8)
        self.drawString(54, 38, "CONFIDENTIAL — Victor's Autonomous Agent Architecture Ecosystem")
        self.drawRightString(558, 38, f"Page {self._pageNumber} of {count}")
        self.restoreState()

PRIMARY = colors.HexColor("#1A2B4C")
SECONDARY = colors.HexColor("#2B6CB0")
TEXT_DARK = colors.HexColor("#2D3748")
BG_LIGHT = colors.HexColor("#F7FAFC")
BORDER_COLOR = colors.HexColor("#E2E8F0")
CODE_BG = colors.HexColor("#1E293B")

styles = getSampleStyleSheet()
title_style = ParagraphStyle("CoverTitle", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=24, leading=30, textColor=PRIMARY, spaceAfter=10)
subtitle_style = ParagraphStyle("CoverSubtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=13, leading=18, textColor=SECONDARY, spaceAfter=22)
meta_style = ParagraphStyle("CoverMeta", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=TEXT_DARK)
h1 = ParagraphStyle("H1", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=PRIMARY, spaceBefore=18, spaceAfter=8, keepWithNext=True)
h2 = ParagraphStyle("H2", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=SECONDARY, spaceBefore=13, spaceAfter=6, keepWithNext=True)
h3 = ParagraphStyle("H3", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=TEXT_DARK, spaceBefore=10, spaceAfter=4, keepWithNext=True)
body = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=TEXT_DARK, spaceAfter=7)
bullet = ParagraphStyle("Bullet", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=TEXT_DARK, leftIndent=16, firstLineIndent=-10, spaceAfter=4)
code = ParagraphStyle("Code", parent=styles["Normal"], fontName="Courier", fontSize=8, leading=11, textColor=colors.HexColor("#E2E8F0"), spaceBefore=4, spaceAfter=4)
th = ParagraphStyle("TH", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=colors.white)
td = ParagraphStyle("TD", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=TEXT_DARK)

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def sanitize(t):
    rep = {
        "✅": "[OK] ", "❌": "[FAIL] ", "⚠️": "[WARN] ", "→": "->", "⇄": "<->",
        "×": "x", "—": "-", "–": "-", "•": "*", "🤙": "[thumbs-up]",
        "\u00a0": " ",
    }
    for k, v in rep.items():
        t = t.replace(k, v)
    return t

def fmt(t):
    t = sanitize(t)
    t = esc(t)
    t = re.sub(r"`([^`]+)`", r"<font face='Courier' size='8'>\1</font>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
    return t

def is_sep(row):
    cells = [c.strip().strip(":-") for c in row if c.strip()]
    return bool(cells) and all(set(c) <= set("-: ") for c in cells)

def make_table(rows):
    # rows: list of list[str] (raw), first = header, skip separator rows
    data = []
    for row in rows:
        cells = [c.strip() for c in row]
        if is_sep(cells):
            continue
        data.append([Paragraph(fmt(c), th if len(data) == 0 else td) for c in cells])
    if not data:
        return None
    ncol = max(len(r) for r in data)
    widths = [504 / ncol] * ncol
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("PADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
    ]))
    return t

def build():
    with open(SRC, encoding="utf-8") as f:
        lines = f.read().split("\n")

    doc = SimpleDocTemplate(OUT, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    story = []

    # Cover
    story.append(Spacer(1, 60))
    story.append(Paragraph("PROJECT FORCHI", subtitle_style))
    story.append(Paragraph("Updated Master Blueprint & Build Summary", title_style))
    story.append(HRFlowable(width="100%", thickness=3, color=SECONDARY, spaceAfter=22))
    story.append(Paragraph("<b>Author:</b> Pair-programmed with Victor (Chiedozie Victor Agu)", meta_style))
    story.append(Paragraph("<b>System:</b> ForChi — Free 24/7 Telegram Social / Video / Jobs Automation Agent", meta_style))
    story.append(Paragraph("<b>Date:</b> September 1, 2026", meta_style))
    story.append(Paragraph("<b>Status:</b> LIVE & VERIFIED — social, video & jobs workflows healthy", meta_style))
    story.append(Spacer(1, 30))
    box = Table([[Paragraph(
        "<b>SUMMARY:</b> ForChi is a fully free, always-on agent that posts 2x/day to Facebook and 2x/day to LinkedIn with "
        "FLUX-quality styled images, handles chat & voice notes, runs a full long-form YouTube automation pipeline "
        "(channel @sirxlud — AI scripts, cloned voice, AI images, burned-in subtitles, 2 videos/day), and runs an "
        "autonomous job-application workflow (strict intern/junior targeting in cloud security, DevOps/SRE, AI "
        "integration, workflow automation & API integration; tailored resumes + proof-based cover letters; auto-apply "
        "to ATS portals). Built on Render/Contabo + Hugging Face Spaces + Gemini free tier. This document is the "
        "definitive build blueprint and lessons-learned manifest.", body)]], colWidths=[504])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BG_LIGHT), ("BOX", (0, 0), (-1, -1), 1.5, SECONDARY), ("PADDING", (0, 0), (-1, -1), 12)]))
    story.append(box)
    story.append(PageBreak())

    # Body parser
    i = 0
    in_code = False
    code_lines = []
    table_rows = []

    def flush_code():
        nonlocal code_lines
        if code_lines:
            block = "<br/>".join(fmt(l) for l in code_lines)
            t = Table([[Paragraph(block, code)]], colWidths=[504])
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CODE_BG), ("BOX", (0, 0), (-1, -1), 1, BORDER_COLOR), ("PADDING", (0, 0), (-1, -1), 8)]))
            story.append(t)
            story.append(Spacer(1, 6))
            code_lines = []

    def flush_table():
        nonlocal table_rows
        if table_rows:
            t = make_table(table_rows)
            if t:
                story.append(t)
                story.append(Spacer(1, 8))
            table_rows = []

    while i < len(lines):
        line = lines[i].rstrip()

        if in_code:
            if line.strip().startswith("```"):
                in_code = False
                flush_code()
            else:
                code_lines.append(line)
            i += 1
            continue

        if line.strip().startswith("```"):
            flush_table()
            in_code = True
            i += 1
            continue

        if line.startswith("|"):
            flush_code()
            table_rows.append([c for c in line.strip().strip("|").split("|")])
            i += 1
            continue

        flush_table()
        s = line.strip()

        if not s:
            i += 1
            continue
        if s == "---":
            story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceBefore=8, spaceAfter=8))
            i += 1
            continue
        if s.startswith("#### "):
            story.append(Paragraph(fmt(s[5:]), h3)); i += 1; continue
        if s.startswith("### "):
            story.append(Paragraph(fmt(s[4:]), h2)); i += 1; continue
        if s.startswith("## "):
            story.append(Paragraph(fmt(s[3:]), h1)); i += 1; continue
        if s.startswith("# "):
            story.append(Paragraph(fmt(s[2:]), h1)); i += 1; continue
        if re.match(r"^[-*]\s+", s):
            story.append(Paragraph(fmt(re.sub(r"^[-*]\s+", "", s)), bullet)); i += 1; continue
        if re.match(r"^\d+\.\s+", s):
            story.append(Paragraph(fmt(re.sub(r"^(\d+)\.\s+", r"\1. ", s)), bullet)); i += 1; continue
        # paragraph (join with following non-special lines)
        para = [s]
        while i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if not nxt or nxt.startswith(("#", "|", "-", "*", "```")) or nxt == "---" or re.match(r"^\d+\.\s+", nxt):
                break
            para.append(lines[i + 1].strip())
            i += 1
        story.append(Paragraph(fmt(" ".join(para)), body))
        i += 1

    flush_code()
    flush_table()

    doc.build(story, canvasmaker=NumberedCanvas)
    print("PDF written:", OUT)

if __name__ == "__main__":
    build()
