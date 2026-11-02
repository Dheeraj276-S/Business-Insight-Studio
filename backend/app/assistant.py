from __future__ import annotations

import re
from typing import Any

from .analytics import CATEGORIES, _breakdown, _date_range, _trend, analyze_dataset
from .data import Dataset

MAX_QUESTION_LENGTH = 500
UNKNOWN_QUESTION = (
    "I can answer questions about revenue or sales, product or category performance, "
    "best-performing months, profit and margin, trends, and evidence-based improvements. "
    "Try rephrasing your question using one of these topics."
)
CURRENCY_SYMBOLS = re.compile(r"[$€£¥₹]")


def _compact(value: float, currency: str = "") -> str:
    magnitude = abs(value)
    if magnitude >= 10_000_000:
        amount, suffix = value / 10_000_000, " Cr"
    elif magnitude >= 100_000:
        amount, suffix = value / 100_000, " L"
    elif magnitude >= 1_000:
        amount, suffix = value / 1_000, " K"
    else:
        amount, suffix = value, ""
    formatted = f"{abs(amount):,.2f}"
    integer, _, fraction = formatted.partition(".")
    groups = integer.split(",")
    if len(groups) > 1:
        last = groups.pop()
        leading = "".join(groups)
        if len(leading) > 3:
            leading = f"{leading[:-3]},{leading[-3:]}"
        integer = f"{leading},{last}"
    fraction = fraction.rstrip("0")
    number = f"{'-' if value < 0 else ''}{integer}{'.' + fraction if fraction else ''}{suffix}"
    return f"{currency}{number}"


def _detected_currency(dataset: Dataset, mappings: dict[str, str], category_id: str) -> str:
    relevant_fields = ("amount", "cost", "profit", "discount", "campaignSpend", "deliveryCost")
    symbols: set[str] = set()
    for field in relevant_fields:
        column = mappings.get(field)
        if column not in dataset.columns:
            continue
        for row in dataset.rows:
            match = CURRENCY_SYMBOLS.search(str(row.get(column) or ""))
            if match:
                symbols.add(match.group(0))
    return next(iter(symbols)) if len(symbols) == 1 else ""


def _metric(analysis: dict[str, Any], expression: str) -> dict[str, Any] | None:
    pattern = re.compile(expression, re.IGNORECASE)
    return next((metric for metric in analysis["metrics"] if pattern.fullmatch(metric["label"])), None)


def _measure_label(category_id: str) -> str:
    if category_id == "marketing":
        return "campaign spending"
    if category_id == "logistics":
        return "delivery costs"
    return "revenue"


def _label_for_measure_field(field: str) -> str:
    return {
        "amount": "revenue",
        "campaignSpend": "campaign spending",
        "deliveryCost": "delivery costs",
        "quantity": "quantity",
    }.get(field, field)


def _segment_question(
    query: str,
    category_id: str,
    mappings: dict[str, str],
    rows: list[dict[str, Any]],
    aggregation: str,
    currency: str,
) -> dict[str, str] | None:
    requested_field = None
    requested_label = ""
    if re.search(r"\b(products?|items?|services?|menu items?)\b", query):
        requested_field, requested_label = "item", "product"
    elif re.search(r"\b(categories|category|departments?)\b", query):
        requested_field, requested_label = "category", "category"
    elif re.search(r"\b(regions?|locations?|cities|territor(?:y|ies))\b", query):
        requested_field, requested_label = "region", "region"

    asks_lowest = bool(re.search(r"\b(lowest|least|worst|bottom|underperform(?:ing)?|smallest|minimum)\b", query))
    asks_highest = bool(re.search(r"\b(highest|most|best|top|leading|greatest|largest|maximum|performs?\s+best|highest\s+performing)\b", query))
    asks_segment = requested_field is not None and bool(re.search(r"\b(best|top|highest|lowest|least|worst|bottom|perform(?:s|ing)?|revenue|sales|most|greatest|largest|smallest)\b", query))
    if not asks_segment and not (asks_highest or asks_lowest):
        return None

    dimension = mappings.get(requested_field) if requested_field else None
    dimension_label = requested_label
    if requested_field and not dimension:
        return {
            "kind": "notice",
            "answer": f"I can’t rank {requested_label}s because no {requested_label} column is mapped. Map a {requested_label} field first.",
        }
    if not requested_field:
        dimension = mappings.get("item") or mappings.get("category") or mappings.get("region")
        dimension_label = "product, category, or region"
    if not dimension:
        return {"kind": "notice", "answer": "I can’t rank segments because no product, category, or region column is mapped. Map a relevant segment field first."}

    if re.search(r"\b(quantity|units|volume)\b", query):
        measure_field = "quantity"
    elif re.search(r"\b(revenue|sales)\b", query) and category_id != "logistics":
        measure_field = "amount"
    else:
        measure_field = "campaignSpend" if category_id == "marketing" else (
            "deliveryCost" if category_id == "logistics" else "amount"
        )
    measure_column = mappings.get(measure_field)
    if not measure_column:
            return {"kind": "notice", "answer": f"I can’t rank {dimension_label}s by {_label_for_measure_field(measure_field)} because that numeric field is not mapped."}

    groups, warning = _breakdown(
        rows,
        dimension,
        measure_column,
        mappings,
        aggregation if measure_field == "amount" else "row",
    )
    if warning:
        return {"kind": "notice", "answer": warning}
    if not groups:
        return {"kind": "notice", "answer": f"No usable values were found for both the mapped segment and “{measure_column}”. Check the column mappings and numeric values."}
    selected = groups[-1] if asks_lowest else groups[0]
    direction = "lowest" if asks_lowest else "highest"
    measure_label = _label_for_measure_field(measure_field)
    dimension_plural = "categories" if dimension_label == "category" else f"{dimension_label}s"
    return {
        "kind": "answer",
        "answer": f"“{selected['label']}” has the {direction} recorded {measure_label} among mapped {dimension_plural} at {_compact(float(selected['value']), currency)}. This ranks the uploaded values and does not establish a cause.",
    }


def answer_dataset_question(
    question: str,
    dataset: Dataset,
    category_id: str,
    mappings: dict[str, str],
    date_range: str = "all",
    aggregation: str = "row",
) -> dict[str, str]:
    if not isinstance(question, str):
        raise ValueError("Question must be text.")
    text = question.strip()
    if not text:
        raise ValueError("Enter a question about the active dataset.")
    if len(text) > MAX_QUESTION_LENGTH:
        raise ValueError(f"Questions must be {MAX_QUESTION_LENGTH} characters or fewer.")
    if category_id not in CATEGORIES:
        raise ValueError(f"Unsupported business category “{category_id}”.")
    if not dataset.rows:
        return {"kind": "notice", "answer": "The active dataset has no data rows, so I can’t calculate an answer yet."}

    analysis = analyze_dataset(dataset, category_id, mappings, date_range, aggregation)
    rows, _, _ = _date_range(dataset.rows, mappings.get("date"), date_range)
    query = re.sub(r"\s+", " ", text.lower()).strip()
    currency = _detected_currency(dataset, mappings, category_id)

    if re.search(r"\b(recommend|recommendation|improv|improvement|action|suggest|what should|what can i do)\b", query):
        findings = [item["explanation"] for item in analysis["insights"]]
        actions = [
            f"{item['action']} Evidence: {item['basis']}"
            for item in analysis["recommendations"]
        ]
        if not findings and not actions:
            return {
                "kind": "notice",
                "answer": "I can’t suggest a data-supported improvement yet. Map the relevant revenue or sales field and, where useful, date, product, or cost fields.",
            }
        parts = []
        if findings:
            parts.append("Observed from this dataset: " + " ".join(findings[:3]))
        if actions:
            parts.append("Potential actions to consider: " + " ".join(actions[:3]))
        return {"kind": "answer", "answer": " ".join(parts)}

    if re.search(r"\b(best|highest|top|lowest|least|worst)\b", query) and re.search(r"\b(month|monthly)\b", query):
        if not mappings.get("date"):
            return {"kind": "notice", "answer": "I can’t compare months because no date column is mapped. Map a date field and a relevant numeric measure."}
        measure_field = "campaignSpend" if category_id == "marketing" else (
            "deliveryCost" if category_id == "logistics" else "amount"
        )
        measure_column = mappings.get(measure_field)
        if not measure_column:
            return {"kind": "notice", "answer": f"I can’t compare months because no relevant numeric field is mapped for {analysis['trendLabel'].replace(' by month', '').lower()}."}
        all_trend, trend_warning = _trend(
            rows,
            mappings.get("date"),
            measure_column,
            mappings,
            aggregation if measure_field == "amount" else "row",
            limit=None,
        )
        if trend_warning:
            return {"kind": "notice", "answer": trend_warning}
        if not all_trend:
            return {"kind": "notice", "answer": "I can’t compare months because the mapped dates or numeric values are missing or invalid."}
        lowest = bool(re.search(r"\b(lowest|least|worst)\b", query))
        selected = min(all_trend, key=lambda item: item["value"]) if lowest else max(all_trend, key=lambda item: item["value"])
        direction = "lowest" if lowest else "best-performing"
        return {
            "kind": "answer",
            "answer": f"{selected['label']} is the {direction} recorded month for {analysis['trendLabel'].removesuffix(' by month').lower()}, at {_compact(float(selected['value']), currency)}. This is based on the mapped date and amount fields.",
        }

    segment_answer = _segment_question(query, category_id, mappings, rows, aggregation, currency)
    if segment_answer:
        return segment_answer

    if re.search(r"\b(margin|profitability)\b", query):
        metric = _metric(analysis, r"Profit margin")
        if not metric or metric.get("unavailable"):
            return {"kind": "notice", "answer": metric["detail"] if metric else "Profit margin is not available for this business category."}
        return {"kind": "answer", "answer": f"Profit margin is {metric['value']}. {metric['detail']}"}

    if re.search(r"\b(profit|loss|p\s*&\s*l)\b", query):
        metric = _metric(analysis, r"Profit")
        if not metric or metric.get("unavailable"):
            return {"kind": "notice", "answer": metric["detail"] if metric else "Profit is not available for this business category."}
        value = float(metric["rawValue"])
        label = "Calculated loss" if value < 0 else "Calculated profit"
        return {"kind": "answer", "answer": f"{label}: {_compact(value, currency)}. {metric['detail']}"}

    if re.search(r"\b(growth|grow|declin|increas|decreas|month[\s-]*over[\s-]*month|compared? to (?:last|previous|prior))\b", query):
        growth = analysis.get("growth")
        if not mappings.get("date"):
            return {"kind": "notice", "answer": "Growth can’t be calculated because no date column is mapped."}
        if not growth:
            return {"kind": "notice", "answer": "Growth can’t be calculated because the active data does not contain two comparable adjacent months with valid numeric values."}
        change = _compact(abs(float(growth["difference"])), currency)
        percent = f"{abs(float(growth['percentage'])):.2f}%" if growth["percentage"] is not None else "percentage unavailable because the previous total was zero"
        return {
            "kind": "answer",
            "answer": f"Recorded {_measure_label(category_id)} {growth['direction']} by {change} ({percent}) from {growth['previousPeriod']} to {growth['latestPeriod']}. Partial months may not be comparable.",
        }

    if re.search(r"\b(monthly|month by month|each month|monthly sales|monthly trend|sales trends|trend)\b", query):
        if not mappings.get("date"):
            return {"kind": "notice", "answer": "Monthly trends are unavailable because no date column is mapped."}
        measure_field = "campaignSpend" if category_id == "marketing" else (
            "deliveryCost" if category_id == "logistics" else "amount"
        )
        measure_column = mappings.get(measure_field)
        if not measure_column:
            return {"kind": "notice", "answer": f"Monthly trends need a mapped numeric field for {analysis['trendLabel'].replace(' by month', '').lower()}."}
        all_trend, trend_warning = _trend(
            rows,
            mappings.get("date"),
            measure_column,
            mappings,
            aggregation if measure_field == "amount" else "row",
            limit=None,
        )
        if trend_warning:
            return {"kind": "notice", "answer": trend_warning}
        if not all_trend:
            return {"kind": "notice", "answer": "Monthly trends need valid mapped dates and numeric values. The current dataset does not contain usable values for both."}
        points = all_trend[-12:]
        values = "; ".join(f"{point['label']}: {_compact(float(point['value']), currency)}" for point in points)
        return {"kind": "answer", "answer": f"{analysis['trendLabel']} (up to 12 most recent recorded months): {values}."}

    if re.search(r"\b(revenue|sales|turnover|total amount)\b", query):
        metric = next(
            (item for item in analysis["metrics"] if item["label"].lower() in {"total revenue", "total sales", "revenue", "attributed revenue"}),
            None,
        )
        if not metric or metric.get("unavailable"):
            return {"kind": "notice", "answer": metric["detail"] if metric else "A revenue or sales metric is not available for this business category."}
        return {"kind": "answer", "answer": f"{metric['label']}: {_compact(float(metric['rawValue']), currency)}. {metric['detail']}"}

    if re.search(r"\b(order|orders|shipment|shipments|lead|leads|conversion|conversions|quantity|units|spend|cost|return|discount)\b", query):
        words = {word for word in re.findall(r"[a-z]+", query) if len(word) > 3}
        metric = next((item for item in analysis["metrics"] if any(word in item["label"].lower() for word in words)), None)
        if metric:
            if metric.get("unavailable"):
                return {"kind": "notice", "answer": metric["detail"]}
            value = float(metric["rawValue"])
            formatted = f"{value:.2f}".rstrip("0").rstrip(".") + "%" if "margin" in metric["label"].lower() or "rate" in metric["label"].lower() or "roi" in metric["label"].lower() else _compact(value, currency)
            return {"kind": "answer", "answer": f"{metric['label']}: {formatted}. {metric['detail']}"}

    return {"kind": "notice", "answer": UNKNOWN_QUESTION}
