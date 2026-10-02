"""Create private deterministic parser fixtures; never add generated PDFs to git."""
import argparse
import hashlib
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject
import pypdfium2 as pdfium
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


def build(out, fonts):
    out.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("English", str(fonts / "arial.ttf")))
    pdfmetrics.registerFont(TTFont("Chinese", str(fonts / "simsun.ttc"), subfontIndex=0))
    pdfmetrics.registerFont(TTFont("Symbols", str(fonts / "seguisym.ttf")))

    def new(name, size=(612, 792)):
        return canvas.Canvas(str(out / name), pagesize=size, invariant=1)

    def line(c, text, x, y, font="English", size=12):
        c.setFont(font, size)
        c.drawString(x, y, text)

    c = new("native-unrotated.pdf")
    line(c, "Native layout control", 40, 745, size=20)
    for x, label, body in [(40, "LEFT", ["Zn/b-ZnO catalyst at 280 °C.", "Oil yield: 73 wt%; mass: 44 g."]),
                           (326, "RIGHT", ["催化剂编号：实验编号 2026。", "温度 280 °C，质量 44 g。"] )]:
        for i, text in enumerate(body):
            y = 690 - 100 * i
            line(c, f"{label}-{'AB'[i]}", x, y)
            line(c, text, x, y - 25, "Chinese" if label == "RIGHT" else "English")
    rows = [["Catalyst", "Temperature", "Yield"], ["Zn/b-ZnO", "280 °C", "73 wt%"], ["Ru/C", "250 °C", "18.5 wt%"]]
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            c.rect(40 + j * 175, 330 - i * 40, 175, 40)
            line(c, cell, 48 + j * 175, 344 - i * 40)
    line(c, "Native formula: H₂O; x²; −12.5 °C; 3.0 μm", 40, 180, "Symbols")
    c.showPage()
    line(c, "ROTATED-90: temperature −12.5 °C; H₂O; x²; 3.0 μm", 40, 650, "Symbols", 14)
    c.showPage()
    c.setPageSize((1000, 1400))
    x = 35
    for font, text in [("English", "LONG-PAGE: "), ("Chinese", "中文"), ("Symbols", "🔬ZnO −12.5 °C")]:
        line(c, text, x, 1350, font, 14)
        x += pdfmetrics.stringWidth(text, font, 14)
    for i in range(95):
        line(c, f"ROW-{i:03d}: Complete page storage preserves every measured value, unit and source position. Value = {i}.25 mg/L.", 35, 1310 - i * 13, size=11)
    c.showPage()
    c.save()
    writer = PdfWriter()
    reader = PdfReader(out / "native-unrotated.pdf")
    for i, page in enumerate(reader.pages):
        writer.add_page(page)
        if i == 1:
            writer.pages[-1].rotate(90)
    # ReportLab emits five hex digits for non-BMP characters; PDF ToUnicode
    # destinations require UTF-16BE surrogate pairs even when the glyph renders.
    for page in writer.pages:
        for reference in page["/Resources"]["/Font"].values():
            font = reference.get_object()
            mapping = font.get("/ToUnicode")
            if not mapping:
                continue
            original = mapping.get_object().get_data()
            corrected = re.sub(rb"<([0-9A-Fa-f]{5,6})>", lambda match:
                               b"<" + chr(int(match[1], 16)).encode("utf-16-be").hex().upper().encode() + b">", original)
            if corrected != original:
                stream = DecodedStreamObject()
                stream.set_data(corrected)
                font[NameObject("/ToUnicode")] = writer._add_object(stream)
    writer.write(out / "native.pdf")

    pdf = pdfium.PdfDocument(str(out / "native.pdf"))
    scan = pdf[0].render(scale=2.5).to_pil().convert("RGB")
    scan.save(out / "scan-source.png")
    c = new("scan.pdf")
    c.drawImage(ImageReader(scan), 0, 0, 612, 792)
    c.showPage()
    c.save()

    region = Image.new("RGB", (1400, 480), "white")
    draw = ImageDraw.Draw(region)
    chinese_font = ImageFont.truetype(str(fonts / "simsun.ttc"), 42)
    for i, text in enumerate(["SCAN-REGION: catalyst Zn/b-ZnO", "催化剂：ZnO，实验编号 M-2026", "浓度 25.0 mg/L，温度 80 °C。"]):
        draw.text((25, 45 + i * 110), text, font=chinese_font, fill="black")
    c = new("mixed.pdf")
    line(c, "NATIVE-HEADER: retained exactly once", 40, 740, size=17)
    line(c, "The image below contains the measured conditions.", 40, 700)
    c.drawImage(ImageReader(region), 40, 400, 532, 183)
    c.showPage()
    c.save()

    c = new("blank.pdf")
    c.showPage()
    c.save()
    blurred = region.resize((140, 48)).resize(region.size).filter(ImageFilter.GaussianBlur(5))
    c = new("low-quality.pdf")
    c.drawImage(ImageReader(blurred), 40, 400, 532, 183)
    c.showPage()
    c.save()
    encrypted = PdfWriter()
    encrypted.add_page(reader.pages[0])
    encrypted.encrypt("fixture-only-password", algorithm="AES-256")
    encrypted.write(out / "encrypted.pdf")
    (out / "corrupt.pdf").write_bytes(b"%PDF-1.7\ntruncated fixture\n")
    manifest = {}
    for name in ["native.pdf", "scan.pdf", "mixed.pdf", "blank.pdf", "low-quality.pdf", "encrypted.pdf", "corrupt.pdf"]:
        p = out / name
        manifest[name] = {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size}
        if name not in ["encrypted.pdf", "corrupt.pdf"]:
            doc = pdfium.PdfDocument(str(p))
            for n in range(len(doc)):
                doc[n].render(scale=1).to_pil().save(out / f"{p.stem}-page-{n+1}.png")
    (out / "fixture-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("artifacts/docling-pdf-pages/fixtures"))
    parser.add_argument("--fonts", type=Path, default=Path("C:/Windows/Fonts"))
    args = parser.parse_args()
    build(args.output, args.fonts)
