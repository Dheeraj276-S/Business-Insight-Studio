from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .data import Dataset

CATEGORIES: dict[str, dict[str, Any]] = {
    "retail": {
        "name": "Retail & Supermarkets",
        "fields": ["date", "item", "amount", "cost", "quantity", "profit", "category", "region", "customer", "discount", "orderId", "returns"],
    },
    "ecommerce": {
        "name": "E-commerce",
        "fields": ["date", "item", "amount", "cost", "quantity", "profit", "category", "region", "customer", "discount", "orderId", "returns"],
    },
    "restaurant": {
        "name": "Restaurants & Cafes",
        "fields": ["date", "item", "amount", "cost", "quantity", "profit", "category", "region", "customer", "orderId", "discount"],
    },
    "manufacturing": {
        "name": "Manufacturing & Wholesale",
        "fields": ["date", "item", "amount", "cost", "quantity", "profit", "category", "region", "productionQuantity", "waste", "orderId"],
    },
    "marketing": {
        "name": "Digital Marketing",
        "fields": ["date", "item", "campaignSpend", "leads", "conversions", "amount", "region"],
    },
    "logistics": {
        "name": "Logistics & Delivery",
        "fields": ["date", "shipmentId", "deliveryDate", "expectedDate", "deliveryStatus", "deliveryCost", "region", "quantity"],
    },
}

FIELD_LABELS = {
    "date": "Date",
    "item": "Product or service",
    "amount": "Revenue / sales amount",
    "cost": "Cost",
    "quantity": "Quantity",
    "profit": "Profit",
    "category": "Category",
    "region": "Region or location",
    "customer": "Customer",
    "discount": "Discount",
    "orderId": "Order ID",
    "returns": "Returns",
    "campaignSpend": "Campaign spending",
    "leads": "Leads",
    "conversions": "Conversions",
    "deliveryCost": "Delivery cost",
    "shipmentId": "Shipment ID",
    "deliveryDate": "Delivered date",
    "expectedDate": "Expected delivery date",
    "deliveryStatus": "Delivery status",
    "productionQuantity": "Production quantity",
    "waste": "Waste",
}

NUMERIC_FIELDS = {
    "amount", "cost", "quantity", "profit", "discount", "returns",
    "campaignSpend", "leads", "conversions", "deliveryCost",
    "productionQuantity", "waste",
}


def parse_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or "%" in raw:
        return None
    text = re.sub(r"[\s$€£¥₹]", "", raw)
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    if "," in text and "." in text and text.rfind(",") > text.rfind("."):
        text = text.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", text):
        text = text.replace(",", "")
    elif re.fullmatch(r"-?\d+,\d{1,2}", text):
        text = text.replace(",", ".")
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", text):
        return None
    number = float(text) * (-1 if negative else 1)
    return number if math.isfinite(number) else None


def parse_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    iso_text = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(iso_text)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        pass
    try:
        parsed_date = date.fromisoformat(text)
        return datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=timezone.utc)
    except ValueError:
        pass
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})", text)
    if match:
        first, second, year = (int(part) for part in match.groups())
        if first <= 12 and second <= 12 and first != second:
            return None
        month, day = (second, first) if first > 12 else (first, second)
        try:
            return datetime(year, month, day, tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _format(value: float) -> str:
    if not math.isfinite(value):
        return "Not available"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def _metric(label: str, value: float | None, detail: str, percent: bool = False) -> dict[str, Any]:
    if value is None or not math.isfinite(value):
        return {"label": label, "value": "Not available", "detail": detail, "unavailable": True}
    return {
        "label": label,
        "value": f"{_format(value)}%" if percent else _format(value),
        "rawValue": value,
        "detail": detail,
        "unavailable": False,
    }


def _values(rows: list[dict[str, Any]], column: str | None) -> tuple[list[float], int]:
    if not column:
        return [], 0
    values: list[float] = []
    invalid = 0
    for row in rows:
        raw = row.get(column)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            continue
        number = parse_number(raw)
        if number is None:
            invalid += 1
        else:
            values.append(number)
    return values, invalid


def _sum(rows: list[dict[str, Any]], column: str | None) -> float | None:
    values, _ = _values(rows, column)
    return sum(values) if values else None


def _field_detail(rows: list[dict[str, Any]], column: str | None, label: str) -> str:
    if not column:
        return f"Map a {label} column to calculate this metric."
    values, _ = _values(rows, column)
    return (
        f"Uses {len(values):,} valid numeric value(s) from “{column}”."
        if values else f"No usable values were found in the mapped {label} column."
    )


def _order_totals(rows: list[dict[str, Any]], amount_column: str | None, order_column: str | None) -> tuple[dict[str, float], str | None]:
    if not amount_column or not order_column:
        return {}, "Order-level aggregation requires mapped amount and order ID columns."
    amounts: dict[str, set[float]] = defaultdict(set)
    missing_ids = 0
    for row in rows:
        amount = parse_number(row.get(amount_column))
        if amount is None:
            continue
        order_id = str(row.get(order_column) or "").strip()
        if not order_id:
            missing_ids += 1
            continue
        amounts[order_id].add(amount)
    if missing_ids:
        return {}, f"{missing_ids:,} rows with valid amounts have no order ID, so order totals cannot be deduplicated safely."
    conflicts = sum(1 for values in amounts.values() if len(values) > 1)
    if conflicts:
        return {}, f"{conflicts:,} order IDs contain different mapped amounts. Choose row-level amounts or reconcile those orders before using order-level aggregation."
    return {order_id: next(iter(values)) for order_id, values in amounts.items()}, None


def _matched(rows: list[dict[str, Any]], left: str | None, right: str | None) -> tuple[float, float, int]:
    if not left or not right:
        return 0.0, 0.0, 0
    left_sum = right_sum = 0.0
    count = 0
    for row in rows:
        first, second = parse_number(row.get(left)), parse_number(row.get(right))
        if first is None or second is None:
            continue
        left_sum += first
        right_sum += second
        count += 1
    return left_sum, right_sum, count


def _cost_total(rows: list[dict[str, Any]], mappings: dict[str, str], aggregation: str = "row") -> tuple[float | None, str]:
    column = mappings.get("cost")
    quantity_column = mappings.get("quantity")
    if not column:
        return None, "Map a cost column to calculate this metric."
    if aggregation == "order":
        return None, "Total cost is unavailable in order-total mode because cost may be recorded per line item or repeated per order; its granularity must be confirmed."
    if re.search(r"\bunit\s*cost\b|\bcost\s*(?:per|/)\s*unit\b", column, re.I):
        if not quantity_column:
            return None, "The mapped column is a unit cost. Map quantity so total cost can be calculated."
        total = 0.0
        count = 0
        for row in rows:
            unit_cost = parse_number(row.get(column))
            quantity = parse_number(row.get(quantity_column))
            if unit_cost is None or quantity is None:
                continue
            total += unit_cost * quantity
            count += 1
        return (
            (total, f"Unit cost from “{column}” multiplied by quantity from “{quantity_column}” for {count:,} matching rows.")
            if count else
            (None, f"No rows contain valid values for both unit cost “{column}” and quantity “{quantity_column}”.")
        )
    return _sum(rows, column), _field_detail(rows, column, "cost")


def _profit(rows: list[dict[str, Any]], mappings: dict[str, str]) -> tuple[float | None, str, float | None, str]:
    amount, cost_column = mappings.get("amount"), mappings.get("cost")
    if not amount or not cost_column:
        return None, "Map both revenue and a compatible cost column to calculate profit.", None, "Profit margin requires compatible revenue and cost values on the same records."
    if amount == cost_column:
        return None, "Revenue and cost must be mapped to distinct, compatible columns.", None, "Profit margin requires distinct, compatible revenue and cost columns."

    unit_cost = bool(re.search(r"\bunit\s*cost\b|\bcost\s*(?:per|/)\s*unit\b", cost_column, re.I))
    quantity_column = mappings.get("quantity")
    if unit_cost and not quantity_column:
        return None, "The mapped cost is a unit cost; quantity is required to calculate total cost and profit.", None, "Map quantity to multiply unit cost before calculating profit margin."

    revenue_total = cost_total = 0.0
    count = 0
    for row in rows:
        revenue = parse_number(row.get(amount))
        cost = parse_number(row.get(cost_column))
        quantity = parse_number(row.get(quantity_column)) if unit_cost and quantity_column else None
        if revenue is None or cost is None or (unit_cost and quantity is None):
            continue
        revenue_total += revenue
        cost_total += cost * quantity if unit_cost and quantity is not None else cost
        count += 1
    if not count:
        return None, "No rows contain valid values for both compatible revenue and cost fields.", None, "No rows contain valid values for both revenue and cost."
    profit = revenue_total - cost_total
    margin = profit / revenue_total * 100 if revenue_total else None
    profit_detail = (
        f"Revenue less unit cost multiplied by quantity, using “{amount}”, “{cost_column}”, and “{quantity_column}” on {count:,} matching rows."
        if unit_cost else
        f"Revenue less cost per row, using “{amount}” and “{cost_column}” on {count:,} matching rows."
    )
    margin_detail = (
        f"Calculated from {count:,} rows with valid revenue and cost values."
        if revenue_total else "Cannot calculate a percentage because the matched revenue total is zero."
    )
    return profit, profit_detail, margin, margin_detail


def _date_range(rows: list[dict[str, Any]], date_column: str | None, date_range: str) -> tuple[list[dict[str, Any]], list[datetime | None], int]:
    if not date_column:
        return rows, [], 0
    parsed = [parse_date(row.get(date_column)) for row in rows]
    valid = [item for item in parsed if item is not None]
    invalid = len(parsed) - len(valid)
    if date_range == "all":
        return rows, parsed, invalid
    if not valid:
        return [], parsed, invalid
    latest = max(valid)
    start = latest.date().toordinal() - (int(date_range) - 1)
    selected = [
        row for row, item in zip(rows, parsed)
        if item is not None and start <= item.date().toordinal() <= latest.date().toordinal()
    ]
    return selected, parsed, invalid


def _trend(
    rows: list[dict[str, Any]],
    date_column: str | None,
    measure_column: str | None,
    mappings: dict[str, str],
    aggregation: str,
    limit: int | None = 12,
) -> tuple[list[dict[str, Any]], str | None]:
    if not date_column or not measure_column:
        return [], None
    totals: dict[str, float] = defaultdict(float)
    if aggregation == "order" and measure_column == mappings.get("amount"):
        orders, error = _order_totals(rows, measure_column, mappings.get("orderId"))
        if error:
            return [], error
        months: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            order_id = str(row.get(mappings.get("orderId", "")) or "").strip()
            parsed = parse_date(row.get(date_column))
            if order_id in orders and parsed:
                months[order_id].add(parsed.strftime("%Y-%m"))
        if any(len(values) > 1 for values in months.values()):
            return [], "Monthly trend is unavailable in order-total mode because some order IDs span multiple mapped dates or months."
        for order_id, value in orders.items():
            month_values = months.get(order_id)
            if month_values:
                totals[next(iter(month_values))] += value
    else:
        for row in rows:
            parsed, value = parse_date(row.get(date_column)), parse_number(row.get(measure_column))
            if parsed and value is not None:
                totals[parsed.strftime("%Y-%m")] += value
    points = [
        {"label": datetime.strptime(key, "%Y-%m").strftime("%b %y"), "value": value, "period": key}
        for key, value in sorted(totals.items())
    ]
    if limit is not None:
        points = points[-limit:]
    return points, None


def _breakdown(rows: list[dict[str, Any]], label_column: str | None, measure_column: str | None, mappings: dict[str, str], aggregation: str) -> tuple[list[dict[str, Any]], str | None]:
    if not label_column or not measure_column:
        return [], None
    totals: dict[str, float] = defaultdict(float)
    if aggregation == "order" and measure_column == mappings.get("amount"):
        orders, error = _order_totals(rows, measure_column, mappings.get("orderId"))
        if error:
            return [], error
        labels: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            order_id = str(row.get(mappings.get("orderId", "")) or "").strip()
            label = str(row.get(label_column) or "").strip()
            if order_id in orders and label:
                labels[order_id].add(label)
        if any(len(values) > 1 for values in labels.values()):
            return [], f"The {label_column} breakdown is unavailable in order-total mode because some orders contain multiple {label_column} values. Order totals cannot be allocated across those values without guessing."
        for order_id, value in orders.items():
            label_values = labels.get(order_id)
            if label_values:
                totals[next(iter(label_values))] += value
    else:
        for row in rows:
            label = str(row.get(label_column) or "").strip()
            value = parse_number(row.get(measure_column))
            if label and value is not None:
                totals[label] += value
    return [
        {"label": label, "value": value}
        for label, value in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    ], None


def _build_insights(
    category_id: str,
    row_count: int,
    metrics: list[dict[str, Any]],
    trend: list[dict[str, Any]],
    breakdown: list[dict[str, Any]],
    growth: dict[str, Any] | None,
    trend_label: str,
    breakdown_column: str | None,
    breakdown_measure: str | None,
    mappings: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    insights: list[dict[str, Any]] = []
    recommendations: list[dict[str, str]] = []
    by_label = {metric["label"].lower(): metric for metric in metrics}
    amount_name = "campaign spending" if category_id == "marketing" else "delivery costs" if category_id == "logistics" else "revenue"

    def add_metric_insight(title: str, metric: dict[str, Any], explanation: str, period: str = "Selected date range") -> None:
        insights.append({
            "id": title.lower().replace(" ", "-"),
            "title": title,
            "metric": metric["label"],
            "value": metric["value"],
            "rawValue": metric.get("rawValue"),
            "valueType": "percent" if "%" in metric["value"] else "amount",
            "period": period,
            "explanation": explanation,
        })

    if row_count == 0:
        return [], [{
            "id": "upload-data-rows",
            "title": "Add data rows",
            "action": "Potential action: upload a dataset with transaction or business activity rows to generate evidence-based insights.",
            "basis": "The active dataset contains no data rows.",
        }]

    if breakdown and breakdown_column and breakdown_measure:
        dimension = "product" if breakdown_column == mappings.get("item") else "category" if breakdown_column == mappings.get("category") else "segment"
        measure = "quantity" if breakdown_measure == mappings.get("quantity") else amount_name
        top = breakdown[0]
        insights.append({
            "id": "highest-performing-segment",
            "title": f"Highest recorded {dimension}",
            "metric": f"{measure.title()} by {dimension}",
            "value": _format(top["value"]),
            "rawValue": top["value"],
            "valueType": "amount" if measure != "quantity" else "count",
            "period": "Selected date range",
            "explanation": f"“{top['label']}” has the highest summed mapped {measure} among {len(breakdown):,} {dimension} group(s), using rows with both a label and valid numeric value.",
        })
        if len(breakdown) > 1:
            low = breakdown[-1]
            insights.append({
                "id": "lowest-performing-segment",
                "title": f"Lowest recorded {dimension}",
                "metric": f"{measure.title()} by {dimension}",
                "value": _format(low["value"]),
                "rawValue": low["value"],
                "valueType": "amount" if measure != "quantity" else "count",
                "period": "Selected date range",
                "explanation": f"“{low['label']}” has the lowest summed mapped {measure} among {len(breakdown):,} {dimension} group(s). This ranks recorded values only and does not establish a cause.",
            })
            recommendations.append({
                "id": "review-low-segment",
                "title": f"Review {low['label']}",
                "action": f"Potential action: review the records and business context for “{low['label']},” the lowest recorded {dimension} by mapped {measure}. The figures alone do not explain its performance.",
                "basis": f"Lowest recorded {dimension}: {low['label']} ({_format(low['value'])}).",
            })

    if trend:
        first, latest = trend[0], trend[-1]
        details = "; ".join(f"{point['label']}: {_format(point['value'])}" for point in trend)
        insights.append({
            "id": "monthly-trend",
            "title": "Monthly trend",
            "metric": trend_label,
            "value": _format(latest["value"]),
            "rawValue": latest["value"],
            "valueType": "amount",
            "period": latest["label"] if len(trend) == 1 else f"{first['label']}–{latest['label']}",
            "explanation": f"Monthly totals are summed from rows with valid mapped dates and numeric values. Recorded values: {details}. Month completeness is not established by the file.",
        })
    if growth:
        previous = next(point for point in trend if point["label"] == growth["previousPeriod"])
        latest = next(point for point in trend if point["label"] == growth["latestPeriod"])
        percentage_text = f" ({_format(abs(growth['percentage']))}%)" if growth["percentage"] is not None else " (percentage unavailable because the previous total was zero)"
        insights.append({
            "id": "period-over-period-change",
            "title": "Period-over-period change",
            "metric": trend_label.removesuffix(" by month"),
            "value": f"{'+' if growth['difference'] > 0 else ''}{_format(growth['difference'])}{percentage_text}",
            "rawValue": growth["difference"],
            "valueType": "amount",
            "period": f"{growth['previousPeriod']} to {growth['latestPeriod']}",
            "percentage": growth["percentage"],
            "explanation": f"Recorded {amount_name} {growth['direction']} from {_format(previous['value'])} to {_format(latest['value'])}. The compared months are adjacent recorded months; completeness of either month is unknown.",
        })
        if growth["direction"] == "decreased":
            recommendations.append({
                "id": "review-period-decline",
                "title": "Review the recorded decline",
                "action": "Potential action: inspect the underlying transactions and compare like-for-like periods to understand the recorded decline. This dataset does not identify its cause.",
                "basis": f"{trend_label.removesuffix(' by month')} decreased from {growth['previousPeriod']} to {growth['latestPeriod']}.",
            })

    revenue = by_label.get("total revenue") or by_label.get("total sales") or by_label.get("revenue")
    costs = next((metric for label, metric in by_label.items() if "cost" in label and metric.get("rawValue") is not None), None)
    revenue_metric = revenue or by_label.get("attributed revenue")
    if revenue_metric and revenue_metric.get("rawValue") is not None and costs:
        insights.append({
            "id": "revenue-cost-comparison",
            "title": "Revenue and cost",
            "metric": "Revenue compared with mapped cost",
            "value": costs["value"],
            "rawValue": costs["rawValue"],
            "valueType": "amount",
            "period": "Selected date range",
            "explanation": f"{revenue_metric['label']} is {_format(revenue_metric['rawValue'])} and {costs['label'].lower()} is {_format(costs['rawValue'])}, using the active mapped values. This comparison does not imply why costs were incurred.",
        })

    for label in ("profit", "profit margin"):
        metric = by_label.get(label)
        if metric and not metric.get("unavailable"):
            add_metric_insight(
                "Calculated profit" if label == "profit" else "Calculated profit margin",
                metric,
                metric.get("detail", "Calculated from the active dataset and mappings."),
            )
            if label == "profit" and metric.get("rawValue", 0) < 0:
                recommendations.append({
                    "id": "review-negative-profit",
                    "title": "Review the recorded loss",
                    "action": "Potential action: validate the mapped revenue and cost records, then review the largest transactions before considering operational changes. This result does not identify a cause.",
                    "basis": f"Calculated profit is {_format(metric['rawValue'])} for the selected date range.",
                })

    if not mappings.get("date"):
        recommendations.append({
            "id": "map-date",
            "title": "Enable time-based analysis",
            "action": "Potential action: map a valid date column to enable monthly trends and period comparisons.",
            "basis": "No date column is mapped.",
        })
    elif not trend:
        recommendations.append({
            "id": "check-trend-values",
            "title": "Check dates and numeric values",
            "action": "Potential action: verify that mapped dates parse correctly and that the relevant numeric field contains usable values.",
            "basis": "No monthly totals could be calculated from the mapped date and measure fields.",
        })
    if category_id not in {"marketing", "logistics"} and not mappings.get("amount"):
        recommendations.append({
            "id": "map-revenue",
            "title": "Map revenue or sales",
            "action": "Potential action: map the column that records revenue or sales to enable revenue-based findings.",
            "basis": "No revenue or sales amount is mapped.",
        })
    elif category_id not in {"marketing", "logistics"} and mappings.get("amount") and revenue_metric and revenue_metric.get("unavailable"):
        recommendations.append({
            "id": "check-revenue-values",
            "title": "Validate mapped sales values",
            "action": "Potential action: check that the mapped revenue or sales column contains valid numeric amounts in the active records.",
            "basis": revenue_metric.get("detail", "No usable revenue or sales values were found."),
        })
    if category_id in {"retail", "ecommerce", "restaurant", "manufacturing"} and mappings.get("amount") and not mappings.get("cost"):
        recommendations.append({
            "id": "map-cost",
            "title": "Map a compatible cost field",
            "action": "Potential action: map a cost field with the same row-level meaning as revenue to enable profit and margin calculations.",
            "basis": "Revenue is mapped, but compatible cost is not; profit and margin are unavailable.",
        })
    elif category_id in {"retail", "ecommerce", "restaurant", "manufacturing"} and mappings.get("cost") and not costs:
        cost_metric = next((metric for label, metric in by_label.items() if "cost" in label), None)
        if cost_metric and cost_metric.get("unavailable"):
            recommendations.append({
                "id": "check-cost-values",
                "title": "Validate mapped cost values",
                "action": "Potential action: verify that the mapped cost values are numeric and recorded at a compatible level with revenue before interpreting profit or margin.",
                "basis": cost_metric.get("detail", "No usable compatible cost values were found."),
            })

    return insights, recommendations


def analyze_dataset(dataset: Dataset, category_id: str, mappings: dict[str, str], date_range: str = "all", aggregation: str = "row") -> dict[str, Any]:
    if category_id not in CATEGORIES:
        raise ValueError(f"Unsupported business category “{category_id}”.")
    category = CATEGORIES[category_id]
    if date_range not in {"all", "30", "90"}:
        raise ValueError("Date range must be one of: all, 30, or 90.")
    if aggregation not in {"row", "order"}:
        raise ValueError("Aggregation must be row or order.")
    if aggregation == "order" and "amount" in category["fields"] and not mappings.get("orderId"):
        raise ValueError("Map an Order ID column before selecting order-total aggregation.")
    for field, column in mappings.items():
        if field not in category["fields"]:
            raise ValueError(f"The “{field}” field is not available for {category['name']}.")
        if column not in dataset.columns:
            raise ValueError(f"Mapped column “{column}” for “{field}” is not in this uploaded file.")

    date_column = mappings.get("date")
    rows, _, invalid_dates = _date_range(dataset.rows, date_column, date_range)
    metrics: list[dict[str, Any]] = []
    warnings = list(dataset.warnings)
    if dataset.missing_values:
        warnings.append(f"{dataset.missing_values:,} cells are blank. Missing values are retained and skipped only by calculations that need them.")
    if date_column and invalid_dates:
        warnings.append(f"{invalid_dates:,} row(s) have a missing or ambiguous date in the mapped date column; dates are not guessed.")

    for field in NUMERIC_FIELDS:
        column = mappings.get(field)
        if not column:
            continue
        _, invalid = _values(rows, column)
        if invalid:
            warnings.append(f"{invalid:,} non-empty value(s) in “{column}” could not be read as numbers and are excluded from calculations using that column.")

    amount_field = "campaignSpend" if category_id == "marketing" else "deliveryCost" if category_id == "logistics" else "amount"
    measure_column = mappings.get(amount_field)
    amount_values, _ = _values(rows, measure_column)
    amount_total = sum(amount_values) if amount_values else None
    amount_label = "Campaign spending" if category_id == "marketing" else "Delivery costs" if category_id == "logistics" else "Total sales" if category_id == "restaurant" else "Total revenue"
    amount_detail = _field_detail(rows, measure_column, "campaign spending" if category_id == "marketing" else "delivery cost" if category_id == "logistics" else "revenue")

    if amount_field == "amount" and aggregation == "order":
        orders, error = _order_totals(rows, measure_column, mappings.get("orderId"))
        if error:
            amount_total = None
            amount_detail = error
        else:
            amount_total = sum(orders.values()) if orders else None
            amount_detail = (
                f"Counted one consistent mapped total for each of {len(orders):,} unique orders in “{measure_column}”."
                if orders else f"No usable order totals were found in “{measure_column}”."
            )
    if measure_column:
        metrics.append(_metric(amount_label, amount_total, amount_detail))

    if category_id in {"retail", "ecommerce"}:
        ids = {str(row.get(mappings.get("orderId", "")) or "").strip() for row in rows} - {""}
        metrics.append(_metric("Total orders", float(len(ids)) if ids else None, "Unique non-empty order IDs in this range." if mappings.get("orderId") else "Map an order ID column; rows are not assumed to be unique orders."))
        cost, cost_detail = _cost_total(rows, mappings, aggregation)
        metrics.append(_metric("Total cost", cost, cost_detail))
        profit, profit_detail, margin, margin_detail = _profit(rows, mappings)
        if aggregation == "order":
            profit, margin = None, None
            profit_detail = "Profit is not calculated in order-total mode because the mapped cost or profit column may use a different row granularity."
            margin_detail = "Profit margin is unavailable until revenue and profit or cost use a confirmed, compatible aggregation level."
            warnings.append("Revenue is counted once per unique order ID. Profit and profit margin are withheld because cost or profit granularity is not confirmed.")
        metrics.append(_metric("Profit", profit, profit_detail))
        metrics.append(_metric("Profit margin", margin, margin_detail, percent=True))
        metrics.append(_metric("Returns", _sum(rows, mappings.get("returns")), _field_detail(rows, mappings.get("returns"), "returns")))
        metrics.append(_metric("Discounts", _sum(rows, mappings.get("discount")), _field_detail(rows, mappings.get("discount"), "discount")))
    elif category_id == "restaurant":
        metrics.append(_metric("Items sold", _sum(rows, mappings.get("quantity")), _field_detail(rows, mappings.get("quantity"), "quantity")))
        cost, cost_detail = _cost_total(rows, mappings, aggregation)
        metrics.append(_metric("Food / product cost", cost, cost_detail))
        profit, profit_detail, margin, margin_detail = _profit(rows, mappings)
        if aggregation == "order":
            profit, margin = None, None
            profit_detail = "Profit is unavailable in order-total mode because cost granularity is not confirmed."
            margin_detail = "Profit margin is unavailable until revenue and cost use a confirmed, compatible aggregation level."
        metrics.append(_metric("Profit", profit, profit_detail))
        metrics.append(_metric("Profit margin", margin, margin_detail, percent=True))
        if mappings.get("orderId") and measure_column:
            order_totals, error = _order_totals(rows, measure_column, mappings.get("orderId"))
            if aggregation == "order":
                order_values = list(order_totals.values())
            else:
                order_values_by_id: dict[str, float] = defaultdict(float)
                for row in rows:
                    order_id = str(row.get(mappings["orderId"]) or "").strip()
                    amount = parse_number(row.get(measure_column))
                    if order_id and amount is not None:
                        order_values_by_id[order_id] += amount
                order_values = list(order_values_by_id.values())
            average = sum(order_values) / len(order_values) if order_values and not (aggregation == "order" and error) else None
            metrics.append(_metric("Average order value", average, error if aggregation == "order" and error else f"Average of {len(order_values):,} order totals." if order_values else "No valid order totals are available."))
    elif category_id == "manufacturing":
        quantity_column = mappings.get("productionQuantity") or mappings.get("quantity")
        metrics.append(_metric("Production quantity", _sum(rows, quantity_column), _field_detail(rows, quantity_column, "production quantity")))
        cost, cost_detail = _cost_total(rows, mappings, aggregation)
        metrics.append(_metric("Production cost", cost, cost_detail))
        profit, profit_detail, margin, margin_detail = _profit(rows, mappings)
        if aggregation == "order":
            profit, margin = None, None
            profit_detail = "Profit is unavailable in order-total mode because cost granularity is not confirmed."
            margin_detail = "Profit margin is unavailable until revenue and cost use a confirmed, compatible aggregation level."
        metrics.append(_metric("Profit", profit, profit_detail))
        metrics.append(_metric("Profit margin", margin, margin_detail, percent=True))
        metrics.append(_metric("Recorded waste", _sum(rows, mappings.get("waste")), _field_detail(rows, mappings.get("waste"), "waste")))
    elif category_id == "marketing":
        for field, label in (("leads", "Leads"), ("conversions", "Conversions"), ("amount", "Attributed revenue")):
            metrics.append(_metric(label, _sum(rows, mappings.get(field)), _field_detail(rows, mappings.get(field), label.lower())))
        spend, leads, _ = _matched(rows, mappings.get("campaignSpend"), mappings.get("leads"))
        metrics.append(_metric("Cost per lead", spend / leads if leads else None, "Campaign spending divided by leads on matching rows." if leads else "Requires campaign spending and leads on the same rows, with non-zero leads."))
        conversions, leads, _ = _matched(rows, mappings.get("conversions"), mappings.get("leads"))
        metrics.append(_metric("Conversion rate", conversions / leads * 100 if leads else None, "Conversions divided by leads on matching rows." if leads else "Requires conversions and leads on the same rows, with non-zero leads.", percent=True))
        revenue, spend, _ = _matched(rows, mappings.get("amount"), mappings.get("campaignSpend"))
        roi = (revenue - spend) / spend * 100 if spend else None
        metrics.append(_metric("Campaign ROI", roi, "Revenue less campaign spending, divided by spending on matching rows." if spend else "Requires attributed revenue and campaign spending on matching rows, with non-zero spending.", percent=True))
    elif category_id == "logistics":
        ids = {str(row.get(mappings.get("shipmentId", "")) or "").strip() for row in rows} - {""}
        metrics.append(_metric("Total shipments", float(len(ids)) if ids else None, "Unique non-empty shipment IDs in this range." if mappings.get("shipmentId") else "Map a shipment ID; rows are not assumed to be unique shipments."))
        delivered_column = mappings.get("deliveryDate")
        shipped_column = mappings.get("date")
        durations = [
            (delivered - shipped).total_seconds() / 86400
            for row in rows
            if shipped_column and delivered_column
            if (shipped := parse_date(row.get(shipped_column))) is not None
            if (delivered := parse_date(row.get(delivered_column))) is not None
            if delivered >= shipped
        ]
        metrics.append(_metric(
            "Average delivery time",
            sum(durations) / len(durations) if durations else None,
            f"Calculated for {len(durations):,} rows with valid date pairs." if durations else "Map shipment and delivered dates to calculate delivery time.",
            percent=False,
        ))
        expected_column, status_column = mappings.get("expectedDate"), mappings.get("deliveryStatus")
        on_time = evaluated = 0
        if expected_column and delivered_column:
            for row in rows:
                expected, delivered = parse_date(row.get(expected_column)), parse_date(row.get(delivered_column))
                if expected and delivered:
                    evaluated += 1
                    if delivered <= expected:
                        on_time += 1
        elif status_column:
            for row in rows:
                status = re.sub(r"[^a-z]", "", str(row.get(status_column) or "").lower())
                if "ontime" in status:
                    on_time += 1
                    evaluated += 1
                elif any(token in status for token in ("late", "delay", "overdue")):
                    evaluated += 1
        metrics.append(_metric(
            "On-time delivery",
            on_time / evaluated * 100 if evaluated else None,
            f"Based on {evaluated:,} shipments with comparable delivery dates or recognized delivery statuses." if evaluated else "Map an on-time/late status or both expected and delivered dates.",
            percent=True,
        ))
        metrics.append(_metric("Delivery costs", _sum(rows, mappings.get("deliveryCost")), _field_detail(rows, mappings.get("deliveryCost"), "delivery cost")))
        metrics.append(_metric("Quantity shipped", _sum(rows, mappings.get("quantity")), _field_detail(rows, mappings.get("quantity"), "quantity")))

    if aggregation == "row" and mappings.get("orderId") and mappings.get("amount"):
        counts = Counter(str(row.get(mappings["orderId"]) or "").strip() for row in rows)
        repeated_orders = sum(1 for order_id, count in counts.items() if order_id and count > 1)
        if repeated_orders:
            warnings.append(f"{repeated_orders:,} order IDs appear on multiple rows. Revenue is summed per row; confirm mapped amounts are line items, not order totals repeated on each line.")

    trend_measure_field = "campaignSpend" if category_id == "marketing" else "deliveryCost" if category_id == "logistics" else "amount"
    trend_measure = mappings.get(trend_measure_field)
    trend_label = "Campaign spending by month" if category_id == "marketing" else "Delivery costs by month" if category_id == "logistics" else "Sales by month"
    trend, trend_warning = _trend(rows, date_column, trend_measure, mappings, aggregation if trend_measure_field == "amount" else "row")
    breakdown_column = mappings.get("region") if category_id == "logistics" else mappings.get("item") or mappings.get("category") or mappings.get("region")
    breakdown_measure = mappings.get("campaignSpend") if category_id == "marketing" else mappings.get("deliveryCost") if category_id == "logistics" else mappings.get("amount") or mappings.get("quantity")
    all_breakdown, breakdown_warning = _breakdown(rows, breakdown_column, breakdown_measure, mappings, aggregation if breakdown_measure == mappings.get("amount") else "row")
    breakdown = all_breakdown[:8]
    if trend_warning:
        warnings.append(trend_warning)
    if breakdown_warning:
        warnings.append(breakdown_warning)

    growth = None
    observations: list[str] = []
    adjacent_month = False
    if len(trend) >= 2:
        previous_month = datetime.strptime(trend[-2]["period"], "%Y-%m").replace(day=1)
        next_month = (previous_month + timedelta(days=32)).replace(day=1)
        adjacent_month = trend[-1]["period"] == next_month.strftime("%Y-%m")
    if adjacent_month:
        previous, latest = trend[-2], trend[-1]
        difference = latest["value"] - previous["value"]
        percentage = difference / abs(previous["value"]) * 100 if previous["value"] else None
        growth = {
            "previousPeriod": previous["label"],
            "latestPeriod": latest["label"],
            "difference": difference,
            "percentage": percentage,
            "direction": "increased" if difference > 0 else "decreased" if difference < 0 else "unchanged",
        }
        change = f"{_format(abs(difference))}" + (f" ({_format(abs(percentage))}%)" if percentage is not None else " (percentage unavailable; prior total was zero)")
        observations.append(f"Recorded {trend_label.removesuffix(' by month').lower()} {growth['direction']} by {change} from {previous['label']} to {latest['label']}. Partial months may not be comparable.")
    elif date_column:
        if len(trend) >= 2:
            warnings.append("Growth comparison unavailable: the two latest recorded months are not adjacent, so a period-over-period comparison would skip a missing month.")
        else:
            warnings.append("Growth comparison unavailable: at least two months with valid dates and numeric values are needed.")
    if breakdown:
        observations.append(f"“{breakdown[0]['label']}” has the highest recorded value among the displayed {breakdown_column} groups.")

    if date_column and date_range != "all" and invalid_dates:
        warnings.append(f"Rows with missing or ambiguous mapped dates are excluded from this date-filtered view.")
    if not measure_column and category_id not in {"logistics"}:
        warnings.append(f"{FIELD_LABELS.get(amount_field, amount_field)} is not mapped; related metrics cannot be calculated.")

    insights, recommendations = _build_insights(category_id, len(rows), metrics, trend, all_breakdown, growth, trend_label, breakdown_column, breakdown_measure, mappings)
    scoped_dates = [parse_date(row.get(date_column)) for row in rows] if date_column else []
    scoped_dates = [value for value in scoped_dates if value is not None]
    return {
        "fileName": dataset.file_name,
        "rowCount": len(dataset.rows),
        "columnCount": len(dataset.columns),
        "rowsInScopeCount": len(rows),
        "dateRange": date_range,
        "reportingPeriod": {
            "start": min(scoped_dates).date().isoformat(),
            "end": max(scoped_dates).date().isoformat(),
        } if scoped_dates else None,
        "aggregation": aggregation,
        "metrics": metrics,
        "trend": [{"label": point["label"], "value": point["value"]} for point in trend],
        "trendLabel": trend_label if trend_measure else "Trend unavailable",
        "breakdown": breakdown,
        "breakdownLabel": f"Performance by {breakdown_column}" if breakdown_column else "Breakdown unavailable",
        "growth": growth,
        "insights": insights,
        "recommendations": recommendations,
        "qualityNotes": list(dict.fromkeys(warnings)),
        "observations": observations,
    }
