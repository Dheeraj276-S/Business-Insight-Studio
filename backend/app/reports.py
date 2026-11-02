from __future__ import annotations

import io
import os
import re
from datetime import datetime
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.lib.colors import HexColor
from reportlab.pdfgen.canvas import Canvas

from .data import Dataset

NAVY = HexColor("#24304c")
INDIGO = HexColor("#6573ed")
MUTED = HexColor("#68758a")
LIGHT = HexColor("#eef0ff")
GRID = HexColor("#e6eaf2")
PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 18 * mm
CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
FONT_NAME = "Helvetica"
CURRENCY_SYMBOLS = re.compile(r"[$€£¥₹]")


def _register_unicode_font() -> bool:
    candidates = [
        ("C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\arialbd.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for regular, bold in candidates:
        if os.path.isfile(regular) and os.path.isfile(bold):
            try:
                pdfmetrics.registerFont(TTFont("BISUnicode", regular))
                pdfmetrics.registerFont(TTFont("BISUnicode-Bold", bold))
                return True
            except (OSError, ValueError):
                continue
    return False


HAS_UNICODE_FONT = _register_unicode_font()
if HAS_UNICODE_FONT:
    FONT_NAME = "BISUnicode"


def _indian_number(value: float, digits: int = 2) -> str:
    rounded = f"{abs(value):,.{digits}f}"
    integer, _, fraction = rounded.partition(".")
    western_groups = integer.split(",")
    if len(western_groups) > 1:
        last = western_groups.pop()
        leading = "".join(western_groups)
        if len(leading) > 3:
            leading = leading[:-3] + "," + leading[-3:]
        integer = leading + "," + last
    fraction = fraction.rstrip("0")
    return f"{'-' if value < 0 else ''}{integer}{'.' + fraction if fraction else ''}"


def _compact(value: float, currency: str = "") -> str:
    magnitude = abs(value)
    if magnitude >= 10_000_000:
        amount, suffix = value / 10_000_000, " Cr"
        digits = 2
    elif magnitude >= 100_000:
        amount, suffix = value / 100_000, " L"
        digits = 2
    elif magnitude >= 1_000:
        amount, suffix = value / 1_000, " K"
        digits = 2
    else:
        amount, suffix, digits = value, "", 2
    symbol = currency if HAS_UNICODE_FONT or currency != "₹" else "INR "
    return f"{symbol}{_indian_number(amount, digits)}{suffix}"


def _exact(value: float, currency: str = "") -> str:
    symbol = currency if HAS_UNICODE_FONT or currency != "₹" else "INR "
    return f"{symbol}{_indian_number(value)}"


def _currency(dataset: Dataset, mappings: dict[str, str]) -> str:
    for field in ("amount", "campaignSpend", "deliveryCost", "cost"):
        column = mappings.get(field)
        if not column:
            continue
        for row in dataset.rows:
            match = CURRENCY_SYMBOLS.search(str(row.get(column) or ""))
            if match:
                return match.group(0)
    return ""


def _safe_paragraph(value: Any) -> str:
    text = str(value)
    if not HAS_UNICODE_FONT:
        text = text.encode("cp1252", "replace").decode("cp1252")
    return escape(text).replace("\n", "<br/>")


def _report_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    normal_font = FONT_NAME
    bold_font = "BISUnicode-Bold" if HAS_UNICODE_FONT else "Helvetica-Bold"
    return {
        "title": ParagraphStyle("BISTitle", parent=base["Title"], fontName=bold_font, fontSize=26, leading=31, textColor=NAVY, alignment=TA_LEFT, spaceAfter=12),
        "subtitle": ParagraphStyle("BISSubtitle", parent=base["Normal"], fontName=normal_font, fontSize=11, leading=17, textColor=MUTED),
        "heading": ParagraphStyle("BISHeading", parent=base["Heading1"], fontName=bold_font, fontSize=17, leading=22, textColor=NAVY, spaceAfter=10),
        "subheading": ParagraphStyle("BISSubheading", parent=base["Heading2"], fontName=bold_font, fontSize=10, leading=14, textColor=NAVY, spaceBefore=8, spaceAfter=5),
        "body": ParagraphStyle("BISBody", parent=base["BodyText"], fontName=normal_font, fontSize=8.5, leading=13, textColor=MUTED, spaceAfter=7),
        "small": ParagraphStyle("BISSmall", parent=base["BodyText"], fontName=normal_font, fontSize=7.5, leading=11, textColor=MUTED),
        "cover_brand": ParagraphStyle("BISBrand", parent=base["Normal"], fontName=bold_font, fontSize=11, leading=16, textColor=INDIGO, spaceAfter=32),
        "cover_meta": ParagraphStyle("BISCoverMeta", parent=base["Normal"], fontName=normal_font, fontSize=9, leading=15, textColor=MUTED),
        "cell": ParagraphStyle("BISCell", parent=base["BodyText"], fontName=normal_font, fontSize=7.5, leading=10, textColor=MUTED),
        "cell_header": ParagraphStyle("BISCellHeader", parent=base["BodyText"], fontName=bold_font, fontSize=7.5, leading=10, textColor=NAVY),
    }


def _paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(_safe_paragraph(value), style)


def _table(
    rows: list[list[Any]],
    styles: dict[str, ParagraphStyle],
    widths: list[float] | None = None,
) -> Table:
    normalized = [
        [_paragraph(cell, styles["cell_header"] if row_index == 0 else styles["cell"]) for cell in row]
        for row_index, row in enumerate(rows)
    ]
    table = Table(normalized, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("TEXTCOLOR", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, HexColor("#fafbfe")]),
    ]))
    return table


class TrendChart(Flowable):
    def __init__(self, points: list[dict[str, Any]], currency: str):
        super().__init__()
        self.points = points
        self.currency = currency
        self.width = CONTENT_WIDTH
        self.height = 75 * mm

    def draw(self) -> None:
        if len(self.points) < 2:
            return
        values = [float(point["value"]) for point in self.points]
        low, high = min(0, min(values)), max(values)
        drawing = Drawing(self.width, self.height)
        chart = LinePlot()
        chart.x = 35
        chart.y = 25
        chart.width = self.width - 50
        chart.height = self.height - 42
        chart.data = [[(index, value) for index, value in enumerate(values)]]
        chart.lines[0].strokeColor = INDIGO
        chart.lines[0].strokeWidth = 2
        chart.lines[0].symbol = None
        chart.xValueAxis.valueMin = 0
        chart.xValueAxis.valueMax = max(1, len(values) - 1)
        chart.xValueAxis.valueSteps = list(range(len(values))) if len(values) <= 8 else None
        chart.yValueAxis.valueMin = low
        chart.yValueAxis.valueMax = high if high != low else low + 1
        chart.yValueAxis.labelTextFormat = lambda value: _compact(float(value), self.currency)
        chart.yValueAxis.labels.fontName = FONT_NAME
        chart.yValueAxis.labels.fontSize = 6
        chart.xValueAxis.labels.fontName = FONT_NAME
        chart.xValueAxis.labels.fontSize = 6
        chart.xValueAxis.labelTextFormat = lambda value: self.points[min(max(int(round(value)), 0), len(self.points) - 1)]["label"]
        chart.yValueAxis.strokeColor = GRID
        chart.xValueAxis.strokeColor = GRID
        drawing.add(chart)
        drawing.drawOn(self.canv, 0, 0)


class NumberedCanvas(Canvas):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            page = self._pageNumber
            self.saveState()
            self.setStrokeColor(GRID)
            self.line(MARGIN, 14 * mm, PAGE_WIDTH - MARGIN, 14 * mm)
            self.setFont(FONT_NAME, 7)
            self.setFillColor(MUTED)
            self.drawString(MARGIN, 9.5 * mm, "Business Insight Studio · Dataset-grounded report")
            self.drawRightString(PAGE_WIDTH - MARGIN, 9.5 * mm, f"{page} / {total}")
            self.restoreState()
            Canvas.showPage(self)
        Canvas.save(self)


def generate_business_report_pdf(
    dataset: Dataset,
    category_name: str,
    category_id: str,
    mappings: dict[str, str],
    date_range: str,
    analysis: dict[str, Any],
) -> bytes:
    """Render a PDF using the validated analytics payload supplied by analyze_dataset."""
    styles = _report_styles()
    currency = _currency(dataset, mappings)
    generated = datetime.now().astimezone().strftime("%d %b %Y, %H:%M %Z")
    reporting_period = analysis["reportingPeriod"]
    period = f"{reporting_period['start']} to {reporting_period['end']}" if reporting_period else "Not available — no valid mapped dates"
    if analysis["dateRange"] != "all":
        period += f" · latest {analysis['dateRange']} days"

    output = io.BytesIO()
    doc = BaseDocTemplate(
        output,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=17 * mm,
        bottomMargin=20 * mm,
        title=f"{category_name} Business Performance Report",
        author="Business Insight Studio",
        subject=f"Dataset report for {dataset.file_name}",
    )
    frame = Frame(MARGIN, 20 * mm, CONTENT_WIDTH, PAGE_HEIGHT - 37 * mm, id="normal")

    def page_header(canvas: Any, document: Any) -> None:
        if document.page == 1:
            return
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, PAGE_HEIGHT - 12 * mm, PAGE_WIDTH, 12 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("BISUnicode-Bold" if HAS_UNICODE_FONT else "Helvetica-Bold", 8)
        canvas.drawString(MARGIN, PAGE_HEIGHT - 8 * mm, "BUSINESS INSIGHT STUDIO")
        canvas.setFont(FONT_NAME, 7)
        canvas.drawRightString(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8 * mm, category_name)
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=page_header)])
    story: list[Any] = [
        Spacer(1, 28 * mm),
        _paragraph("BUSINESS INSIGHT STUDIO", styles["cover_brand"]),
        _paragraph("Business Performance Report", styles["title"]),
        _paragraph(category_name, styles["subtitle"]),
        Spacer(1, 16 * mm),
        Paragraph(f"<b>Dataset</b><br/>{_safe_paragraph(dataset.file_name)}", styles["cover_meta"]),
        Spacer(1, 5 * mm),
        Paragraph(f"<b>Reporting period</b><br/>{_safe_paragraph(period)}", styles["cover_meta"]),
        Spacer(1, 5 * mm),
        Paragraph(f"<b>Generated</b><br/>{_safe_paragraph(generated)}", styles["cover_meta"]),
        Spacer(1, 12 * mm),
        _paragraph("Prepared from the currently uploaded dataset and active column mappings. No external data or AI-generated analysis is used.", styles["body"]),
        PageBreak(),
    ]

    story.extend([
        _paragraph("Executive Summary", styles["heading"]),
        _paragraph(
            f"This report summarizes {dataset.file_name} for {category_name}. "
            f"The uploaded file contains {len(dataset.rows):,} rows and {len(dataset.columns):,} columns; "
            f"{analysis['rowsInScopeCount']:,} rows are in the selected analysis range.",
            styles["body"],
        ),
    ])
    if analysis["insights"]:
        story.append(_paragraph("Key findings", styles["subheading"]))
        for insight in analysis["insights"][:5]:
            story.append(Paragraph(
                f"<b>{_safe_paragraph(insight['title'])}</b> — {_safe_paragraph(insight['explanation'])}",
                styles["body"],
            ))
    else:
        story.append(_paragraph(
            "There are not enough valid mapped values to produce a supported finding. Review the data-quality notes and required mappings below.",
            styles["body"],
        ))
    story.extend([
        _paragraph("Dataset overview", styles["subheading"]),
        _table([
            ["Detail", "Value"],
            ["Business category", category_name],
            ["Dataset file", dataset.file_name],
            ["Reporting period", period],
            ["Rows / columns", f"{len(dataset.rows):,} / {len(dataset.columns):,}"],
            ["Rows in selected range", f"{analysis['rowsInScopeCount']:,}"],
            ["Mapped fields", ", ".join(f"{key} -> {value}" for key, value in mappings.items()) or "None"],
        ], styles, [45 * mm, CONTENT_WIDTH - 45 * mm]),
        PageBreak(),
        _paragraph("KPI Overview", styles["heading"]),
        _paragraph("Only valid metrics calculated by the shared analytics engine are shown. Unavailable or unmapped metrics are described in Data Quality.", styles["body"]),
    ])
    available_metrics = [
        metric for metric in analysis["metrics"]
        if not metric.get("unavailable") and metric.get("rawValue") is not None
    ]
    if available_metrics:
        kpi_rows = [["Metric", "Calculated value", "Calculation / scope"]]
        for metric in available_metrics:
            value = float(metric["rawValue"])
            if "%" in metric["value"]:
                formatted = f"{_indian_number(value)}%"
            elif any(token in metric["label"].lower() for token in ("revenue", "sales", "profit", "cost", "spend", "discount", "order value")):
                exact = _exact(value, currency)
                compact = _compact(value, currency)
                formatted = compact if exact == compact else f"{compact} ({exact})"
            else:
                formatted = _indian_number(value)
            kpi_rows.append([metric["label"], formatted, metric.get("detail", "Calculated from the active dataset.")])
        story.append(_table(kpi_rows, styles, [43 * mm, 36 * mm, CONTENT_WIDTH - 79 * mm]))
    else:
        story.append(_paragraph("No KPI has valid mapped values for the selected dataset and category.", styles["body"]))

    performance_title = {
        "retail": "Sales Performance",
        "ecommerce": "Sales Performance",
        "restaurant": "Sales Performance",
        "manufacturing": "Production & Sales Performance",
        "marketing": "Campaign Performance",
        "logistics": "Operations & Delivery Performance",
    }.get(category_id, "Business Performance")
    story.extend([PageBreak(), _paragraph(performance_title, styles["heading"])])
    trend = analysis["trend"]
    if trend:
        story.append(_paragraph(analysis["trendLabel"], styles["subheading"]))
        if len(trend) > 1:
            story.append(TrendChart(trend, currency))
        story.append(_table(
            [["Month", "Recorded value"]] + [[point["label"], _exact(float(point["value"]), currency)] for point in trend],
            styles,
            [55 * mm, CONTENT_WIDTH - 55 * mm],
        ))
    else:
        story.append(_paragraph(
            "Monthly performance is unavailable. Map a valid date column and a relevant numeric measure; invalid dates and numbers are not estimated.",
            styles["body"],
        ))
    if analysis["breakdown"]:
        story.append(_paragraph(analysis["breakdownLabel"], styles["subheading"]))
        story.append(_table(
            [["Rank", "Product / category / segment", "Recorded value"]] +
            [[str(index), point["label"], _exact(float(point["value"]), currency)] for index, point in enumerate(analysis["breakdown"], 1)],
            styles,
            [15 * mm, CONTENT_WIDTH - 55 * mm, 40 * mm],
        ))
    else:
        story.append(_paragraph(
            "Segment performance is unavailable. Map a product, category, or relevant segment column alongside a numeric measure.",
            styles["body"],
        ))

    story.extend([PageBreak(), _paragraph("Business Insights", styles["heading"])])
    if analysis["insights"]:
        insight_rows = [["Finding", "Value / period", "Derivation"]]
        for insight in analysis["insights"]:
            value = insight["value"]
            if insight.get("rawValue") is not None:
                number = float(insight["rawValue"])
                if insight["valueType"] == "amount":
                    value = _exact(number, currency)
                    if insight.get("percentage") is not None:
                        value += f" ({_indian_number(abs(float(insight['percentage'])))}%)"
                elif insight["valueType"] == "percent":
                    value = f"{_indian_number(number)}%"
                else:
                    value = _indian_number(number)
            insight_rows.append([
                f"{insight['title']} · {insight['metric']}",
                f"{value}\n{insight['period']}",
                insight["explanation"],
            ])
        story.append(_table(insight_rows, styles, [43 * mm, 42 * mm, CONTENT_WIDTH - 85 * mm]))
    else:
        story.append(_paragraph("No findings can be supported by the active dataset and mappings.", styles["body"]))

    story.extend([PageBreak(), _paragraph("Recommendations & Data Quality", styles["heading"])])
    if analysis["recommendations"]:
        story.append(_paragraph("Potential actions to consider", styles["subheading"]))
        story.append(_table(
            [["Suggested action", "Evidence basis"]] +
            [[item["action"], item["basis"]] for item in analysis["recommendations"]],
            styles,
            [CONTENT_WIDTH * 0.6, CONTENT_WIDTH * 0.4],
        ))
    else:
        story.append(_paragraph("No additional actions are suggested from the available evidence.", styles["body"]))

    quality_rows = [
        ["Data-quality item", "Details"],
        ["Missing cells", f"{dataset.missing_values:,}"],
        ["Exact duplicate rows retained", f"{dataset.duplicate_rows:,}"],
        ["Completely blank rows", f"{dataset.empty_rows:,}"],
    ]
    unavailable = [metric for metric in analysis["metrics"] if metric.get("unavailable")]
    quality_rows.extend([[metric["label"], metric.get("detail", "Required mapped data is unavailable.")] for metric in unavailable])
    quality_rows.extend([["Warning", warning] for warning in analysis["qualityNotes"]])
    story.extend([
        Spacer(1, 7 * mm),
        _paragraph("Data quality and limitations", styles["subheading"]),
        _table(quality_rows, styles, [50 * mm, CONTENT_WIDTH - 50 * mm]),
        Spacer(1, 7 * mm),
        _paragraph("Potential actions are prompts for review, not guaranteed outcomes. Validate the source records and business context before making decisions.", styles["small"]),
        Spacer(1, 7 * mm),
        _paragraph("Conclusion", styles["subheading"]),
        _paragraph(
            f"This report summarizes the {category_name.lower()} data and current mappings in {dataset.file_name}. Findings describe recorded values only; potential actions are not forecasts or guaranteed results.",
            styles["body"],
        ),
    ])

    doc.build(story, canvasmaker=NumberedCanvas)
    return output.getvalue()
