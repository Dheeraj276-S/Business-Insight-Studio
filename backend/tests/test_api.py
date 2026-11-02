from __future__ import annotations

import io
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.analytics import analyze_dataset
from app.data import Dataset
import app.main as api_module
from app.main import app

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "retail.csv"
RETAIL_MAPPINGS = {
    "date": "Date",
    "orderId": "Order ID",
    "item": "Product",
    "amount": "Revenue",
    "cost": "Cost",
    "profit": "Profit",
    "quantity": "Quantity",
    "region": "Region",
}


def _csv_upload() -> tuple[str, bytes, str]:
    return "sales.csv", FIXTURE.read_bytes(), "text/csv"


def _excel_upload() -> tuple[str, bytes, str]:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Date", "Revenue", "Product"])
    sheet.append(["2026-01-01", 125, "Tea"])
    output = io.BytesIO()
    workbook.save(output)
    return "sales.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_health_and_categories():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    categories = client.get("/api/categories").json()["categories"]
    retail = next(item for item in categories if item["id"] == "retail")
    assert retail["name"] == "Retail & Supermarkets"
    assert {"id": "amount", "label": "Revenue / sales amount"} in retail["fields"]


def test_cors_allows_explicit_https_origins_and_rejects_wildcards(monkeypatch):
    monkeypatch.setenv(
        "BIS_ALLOWED_ORIGINS",
        "http://localhost:5173,https://BIS.example.com:443,https://preview.example.com:8443",
    )
    assert api_module._allowed_origins() == [
        "http://localhost:5173",
        "https://bis.example.com",
        "https://preview.example.com:8443",
    ]

    monkeypatch.setenv("BIS_ALLOWED_ORIGINS", "https://*.example.com")
    with pytest.raises(RuntimeError, match="explicit HTTPS origins"):
        api_module._allowed_origins()

    monkeypatch.setenv("BIS_ALLOWED_ORIGINS", "https://@bis.example.com")
    with pytest.raises(RuntimeError, match="explicit HTTPS origins"):
        api_module._allowed_origins()


def test_cors_rejects_non_local_http_and_invalid_ports(monkeypatch):
    monkeypatch.setenv("BIS_ALLOWED_ORIGINS", "http://bis.example.com:5173")
    with pytest.raises(RuntimeError, match="local Vite origins"):
        api_module._allowed_origins()

    monkeypatch.setenv("BIS_ALLOWED_ORIGINS", "https://bis.example.com:invalid")
    with pytest.raises(RuntimeError, match="invalid port"):
        api_module._allowed_origins()


def test_preview_csv_returns_types_counts_and_bounded_rows():
    response = client.post("/api/preview", files={"file": _csv_upload()})
    assert response.status_code == 200
    result = response.json()
    assert result["rowCount"] == 3
    assert result["columnCount"] == 8
    assert len(result["sampleRows"]) == 3
    assert {column["name"]: column["inferredType"] for column in result["columns"]}["Revenue"] == "number"
    assert {column["name"]: column["inferredType"] for column in result["columns"]}["Date"] == "date"


def test_preview_accepts_excel_workbook():
    response = client.post("/api/preview", files={"file": _excel_upload()})
    assert response.status_code == 200
    assert response.json()["sampleRows"][0]["Revenue"] == 125


def test_analyze_calculates_revenue_profit_margin_and_growth():
    response = client.post(
        "/api/analyze",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": json.dumps(RETAIL_MAPPINGS)},
    )
    assert response.status_code == 200
    result = response.json()
    metrics = {metric["label"]: metric for metric in result["metrics"]}
    assert metrics["Total revenue"]["value"] == "350"
    assert metrics["Profit"]["value"] == "160"
    assert metrics["Profit"]["rawValue"] == 160
    assert metrics["Profit margin"]["value"] == "45.71%"
    assert result["growth"]["direction"] == "increased"
    assert result["growth"]["difference"] == 50
    assert result["rowsInScopeCount"] == 3


def _assistant(question: str, upload: tuple[str, bytes, str] | None = None, mappings: dict | None = None):
    return client.post(
        "/api/assistant",
        files={"file": upload or _csv_upload()},
        data={
            "category": "retail",
            "question": question,
            "mappings": json.dumps(mappings if mappings is not None else RETAIL_MAPPINGS),
        },
    )


def test_assistant_answers_product_rankings_total_revenue_best_month_and_margin():
    highest = _assistant("Which product has the highest revenue?")
    lowest = _assistant("what item generated the least sales?")
    revenue = _assistant("How much revenue did I make?")
    month = _assistant("Which month performed best?")
    margin = _assistant("What is my profit margin?")

    assert all(response.status_code == 200 for response in (highest, lowest, revenue, month, margin))
    assert "Tea" in highest.json()["answer"] and "300" in highest.json()["answer"]
    assert "Cake" in lowest.json()["answer"] and "50" in lowest.json()["answer"]
    assert "350" in revenue.json()["answer"]
    assert "Feb 26" in month.json()["answer"] and "200" in month.json()["answer"]
    assert "45.71%" in margin.json()["answer"]


def test_assistant_uses_requested_category_breakdown_and_all_months():
    categories = _assistant(
        "Which category has the most revenue?",
        upload=(
            "categories.csv",
            b"Category,Product,Revenue\nSnacks,Chips,50\nDrinks,Tea,70\nSnacks,Nuts,40\n",
            "text/csv",
        ),
        mappings={"category": "Category", "item": "Product", "amount": "Revenue"},
    )
    monthly_rows = ["Date,Revenue"] + [
        f"{year:04d}-{month:02d}-01,{999 if (year, month) == (2025, 1) else 1}"
        for year, month in [(2025, month) for month in range(1, 13)] + [(2026, 1)]
    ]
    month = _assistant(
        "Which month performed best?",
        upload=("monthly.csv", "\n".join(monthly_rows).encode(), "text/csv"),
        mappings={"date": "Date", "amount": "Revenue"},
    )

    assert categories.status_code == month.status_code == 200
    assert "Snacks" in categories.json()["answer"] and "90" in categories.json()["answer"]
    assert "Jan 25" in month.json()["answer"]


def test_assistant_recommendations_and_unknown_questions_are_explicit():
    recommendation = _assistant("What business improvements would you recommend?")
    unsupported = _assistant("What is the weather tomorrow?")
    assert recommendation.status_code == unsupported.status_code == 200
    assert recommendation.json()["kind"] == "answer"
    assert "Potential actions to consider" in recommendation.json()["answer"]
    assert "does not establish" in recommendation.json()["answer"] or "Potential action" in recommendation.json()["answer"]
    assert unsupported.json()["kind"] == "notice"
    assert "rephras" in unsupported.json()["answer"]


def test_assistant_explains_required_mappings_for_product_revenue_and_margin():
    no_product = _assistant("Which product has the highest revenue?", mappings={"amount": "Revenue"})
    no_revenue = _assistant(
        "Which product has the highest revenue?",
        upload=("products.csv", b"Product,Cost\nTea,5\nCoffee,2\n", "text/csv"),
        mappings={"item": "Product"},
    )
    no_cost = _assistant("What is my profit margin?", mappings={"amount": "Revenue"})

    assert no_product.status_code == no_revenue.status_code == no_cost.status_code == 200
    assert no_product.json()["kind"] == "notice"
    assert "no product column is mapped" in no_product.json()["answer"]
    assert "numeric field is not mapped" in no_revenue.json()["answer"]
    assert "cost" in no_cost.json()["answer"].lower()


def test_assistant_validates_questions_uploads_mappings_and_empty_datasets():
    blank = _assistant("   ")
    too_long = _assistant("x" * 501)
    empty = _assistant("What is my total revenue?", upload=("empty.csv", b"Date,Revenue\n", "text/csv"))
    malformed = _assistant("What is my total revenue?", upload=("broken.csv", b'"unclosed,10\n', "text/csv"))
    invalid_mapping = _assistant("What is my total revenue?", mappings={"amount": "missing"})
    invalid_range = client.post(
        "/api/assistant",
        files={"file": _csv_upload()},
        data={"category": "retail", "question": "What is my total revenue?", "mappings": "{}", "range": "365"},
    )

    assert blank.status_code == too_long.status_code == empty.status_code == malformed.status_code == invalid_mapping.status_code == invalid_range.status_code == 422


def test_assistant_answers_are_scoped_to_each_uploaded_dataset():
    first = _assistant(
        "What is my total revenue?",
        upload=("first.csv", b"Revenue\n25\n", "text/csv"),
        mappings={"amount": "Revenue"},
    )
    second = _assistant(
        "What is my total revenue?",
        upload=("second.csv", b"Revenue\n75\n", "text/csv"),
        mappings={"amount": "Revenue"},
    )
    assert first.status_code == second.status_code == 200
    assert "25" in first.json()["answer"]
    assert "75" in second.json()["answer"]
    assert "25" not in second.json()["answer"]


def test_report_pdf_uses_analysis_metrics_and_includes_pages_and_download_headers():
    form = {"category": "retail", "mappings": json.dumps(RETAIL_MAPPINGS)}
    analytics = client.post("/api/analyze", files={"file": _csv_upload()}, data=form)
    response = client.post(
        "/api/report",
        files={"file": _csv_upload()},
        data=form,
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert analytics.status_code == response.status_code == 200
    result = analytics.json()
    metrics = {metric["label"]: metric["value"] for metric in result["metrics"]}
    assert metrics["Total revenue"] == "350"
    assert metrics["Profit"] == "160"
    assert response.headers["content-type"].startswith("application/pdf")
    assert 'attachment; filename="retail-sales-business-report.pdf"' == response.headers["content-disposition"]
    assert "content-disposition" in response.headers["access-control-expose-headers"].lower()
    assert response.content.startswith(b"%PDF-")
    page_count = len(re.findall(rb"/Type\s*/Page\b", response.content))
    assert 5 <= page_count <= 7


def test_report_endpoint_uses_the_same_calculated_metrics_as_analyze(monkeypatch):
    form = {"category": "retail", "mappings": json.dumps(RETAIL_MAPPINGS)}
    analytics = client.post("/api/analyze", files={"file": _csv_upload()}, data=form).json()
    captured: dict = {}

    def capture_report(dataset, category_name, category_id, mappings, date_range, result):
        captured["metrics"] = result["metrics"]
        captured["insights"] = result["insights"]
        return b"%PDF-test"

    monkeypatch.setattr(api_module, "generate_business_report_pdf", capture_report)
    response = client.post("/api/report", files={"file": _csv_upload()}, data=form)

    assert response.status_code == 200
    assert response.content == b"%PDF-test"
    assert captured["metrics"] == analytics["metrics"]
    assert captured["insights"] == analytics["insights"]


def test_report_pdf_without_optional_mappings_explains_unavailable_metrics():
    response = client.post(
        "/api/report",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": '{"amount":"Revenue"}'},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF-")


def test_report_pdf_accepts_excel_uploads():
    response = client.post(
        "/api/report",
        files={"file": _excel_upload()},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue","item":"Product"}'},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF-")


def test_report_handles_long_trends_and_product_names():
    product = "A very long product name " * 8
    records = ["Date,Revenue,Product"]
    records.extend(f"2025-{month:02d}-01,{month * 100},{product} {month}" for month in range(1, 13))
    response = client.post(
        "/api/report",
        files={"file": ("long-trend.csv", "\n".join(records).encode(), "text/csv")},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue","item":"Product"}'},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF-")


def test_report_rejects_empty_invalid_and_incorrectly_mapped_uploads():
    empty = client.post(
        "/api/report",
        files={"file": ("empty.csv", b"Date,Revenue\n", "text/csv")},
        data={"category": "retail", "mappings": '{"amount":"Revenue"}'},
    )
    invalid = client.post(
        "/api/report",
        files={"file": ("broken.csv", b'"unclosed,10\n', "text/csv")},
        data={"category": "retail", "mappings": '{"amount":"Revenue"}'},
    )
    bad_mapping = client.post(
        "/api/report",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": '{"amount":"Unknown"}'},
    )
    assert empty.status_code == invalid.status_code == bad_mapping.status_code == 422


def test_missing_cost_and_dates_are_reported_without_inventing_metrics():
    mappings = {"amount": "Revenue"}
    response = client.post(
        "/api/analyze",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": json.dumps(mappings)},
    )
    assert response.status_code == 200
    metrics = {metric["label"]: metric for metric in response.json()["metrics"]}
    assert metrics["Total revenue"]["value"] == "350"
    assert metrics["Profit"]["unavailable"] is True
    assert metrics["Profit margin"]["unavailable"] is True
    assert response.json()["growth"] is None


def test_missing_order_returns_and_discount_mappings_stay_unavailable():
    response = client.post(
        "/api/analyze",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": '{"amount":"Revenue"}'},
    )
    assert response.status_code == 200
    metrics = {metric["label"]: metric for metric in response.json()["metrics"]}
    for label in ("Total orders", "Returns", "Discounts"):
        assert metrics[label]["value"] == "Not available"
        assert metrics[label]["unavailable"] is True
        assert "Map" in metrics[label]["detail"]


def test_profit_and_margin_require_mapped_revenue_and_cost_not_profit_column():
    response = client.post(
        "/api/analyze",
        files={"file": ("unmapped-cost.csv", b"Revenue,Profit\n100,99\n", "text/csv")},
        data={"category": "retail", "mappings": '{"amount":"Revenue","profit":"Profit"}'},
    )
    assert response.status_code == 200
    metrics = {metric["label"]: metric for metric in response.json()["metrics"]}
    assert metrics["Profit"]["value"] == "Not available"
    assert metrics["Profit margin"]["value"] == "Not available"


def test_profit_and_margin_are_calculated_from_revenue_less_compatible_cost():
    response = client.post(
        "/api/analyze",
        files={"file": ("conflicting-profit.csv", b"Revenue,Cost,Profit\n100,40,999\n", "text/csv")},
        data={"category": "retail", "mappings": '{"amount":"Revenue","cost":"Cost","profit":"Profit"}'},
    )
    assert response.status_code == 200
    metrics = {metric["label"]: metric for metric in response.json()["metrics"]}
    assert metrics["Profit"]["rawValue"] == 60
    assert metrics["Profit margin"]["rawValue"] == 60


def test_insights_rank_highest_and_lowest_product_from_all_groups():
    upload = ("products.csv", b"Product,Revenue\nAlpha,90\nBeta,20\nGamma,50\n", "text/csv")
    response = client.post(
        "/api/analyze",
        files={"file": upload},
        data={"category": "retail", "mappings": '{"item":"Product","amount":"Revenue"}'},
    )
    assert response.status_code == 200
    insights = {item["id"]: item for item in response.json()["insights"]}
    assert insights["highest-performing-segment"]["value"] == "90"
    assert "Alpha" in insights["highest-performing-segment"]["explanation"]
    assert insights["lowest-performing-segment"]["value"] == "20"
    assert "Beta" in insights["lowest-performing-segment"]["explanation"]


def test_monthly_trend_and_period_change_share_analytics_totals():
    response = client.post(
        "/api/analyze",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": json.dumps(RETAIL_MAPPINGS)},
    )
    assert response.status_code == 200
    result = response.json()
    insights = {item["id"]: item for item in result["insights"]}
    assert result["trend"] == [{"label": "Jan 26", "value": 150}, {"label": "Feb 26", "value": 200}]
    assert insights["monthly-trend"]["rawValue"] == 200
    assert insights["monthly-trend"]["period"] == "Jan 26–Feb 26"
    change = insights["period-over-period-change"]
    assert change["rawValue"] == 50
    assert round(change["percentage"], 2) == 33.33
    assert change["period"] == "Jan 26 to Feb 26"
    assert "from 150 to 200" in change["explanation"]
    assert any(item["id"] == "revenue-cost-comparison" for item in result["insights"])
    profit = next(item for item in result["metrics"] if item["label"] == "Profit")
    margin = next(item for item in result["metrics"] if item["label"] == "Profit margin")
    profit_insight = next(item for item in result["insights"] if item["id"] == "calculated-profit")
    margin_insight = next(item for item in result["insights"] if item["id"] == "calculated-profit-margin")
    assert profit_insight["rawValue"] == profit["rawValue"] == 160
    assert margin_insight["rawValue"] == margin["rawValue"]


def test_missing_date_revenue_and_cost_fields_explain_unavailable_findings():
    no_date = client.post(
        "/api/analyze",
        files={"file": ("no-date.csv", b"Product,Revenue\nA,10\nB,5\n", "text/csv")},
        data={"category": "retail", "mappings": '{"item":"Product","amount":"Revenue"}'},
    )
    assert no_date.status_code == 200
    assert not any(item["id"] == "monthly-trend" for item in no_date.json()["insights"])
    assert any(item["id"] == "map-date" for item in no_date.json()["recommendations"])

    no_revenue = client.post(
        "/api/analyze",
        files={"file": ("no-revenue.csv", b"Date,Product\n2026-01-01,A\n2026-02-01,B\n", "text/csv")},
        data={"category": "retail", "mappings": '{"date":"Date","item":"Product"}'},
    )
    assert no_revenue.status_code == 200
    assert not any(item["id"] == "monthly-trend" for item in no_revenue.json()["insights"])
    assert any(item["id"] == "map-revenue" for item in no_revenue.json()["recommendations"])

    no_cost = client.post(
        "/api/analyze",
        files={"file": ("no-cost.csv", b"Revenue\n100\n", "text/csv")},
        data={"category": "retail", "mappings": '{"amount":"Revenue"}'},
    )
    assert no_cost.status_code == 200
    metrics = {metric["label"]: metric for metric in no_cost.json()["metrics"]}
    assert metrics["Profit"]["unavailable"] is True
    assert not any(item["id"] == "calculated-profit" for item in no_cost.json()["insights"])
    assert any(item["id"] == "map-cost" for item in no_cost.json()["recommendations"])


def test_zero_revenue_and_insufficient_months_do_not_create_false_growth():
    upload = ("zero.csv", b"Date,Revenue,Cost\n2026-01-10,0,0\n2026-02-10,0,0\n", "text/csv")
    response = client.post(
        "/api/analyze",
        files={"file": upload},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue","cost":"Cost"}'},
    )
    assert response.status_code == 200
    result = response.json()
    metrics = {metric["label"]: metric for metric in result["metrics"]}
    assert result["growth"]["direction"] == "unchanged"
    assert result["growth"]["percentage"] is None
    assert metrics["Profit"]["rawValue"] == 0
    assert metrics["Profit margin"]["unavailable"] is True

    one_month = client.post(
        "/api/analyze",
        files={"file": ("one-month.csv", b"Date,Revenue\n2026-02-10,25\n", "text/csv")},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue"}'},
    )
    assert one_month.status_code == 200
    assert one_month.json()["growth"] is None
    assert any("at least two months" in warning for warning in one_month.json()["qualityNotes"])

    skipped_month = client.post(
        "/api/analyze",
        files={"file": ("skipped-month.csv", b"Date,Revenue\n2026-01-10,10\n2026-03-10,30\n", "text/csv")},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue"}'},
    )
    assert skipped_month.status_code == 200
    assert skipped_month.json()["growth"] is None
    assert any("not adjacent" in warning for warning in skipped_month.json()["qualityNotes"])


def test_replacing_dataset_replaces_insight_context():
    first = client.post(
        "/api/analyze",
        files={"file": ("first.csv", b"Product,Revenue\nOld Product,25\n", "text/csv")},
        data={"category": "retail", "mappings": '{"item":"Product","amount":"Revenue"}'},
    )
    second = client.post(
        "/api/analyze",
        files={"file": ("second.csv", b"Product,Revenue\nNew Product,75\n", "text/csv")},
        data={"category": "retail", "mappings": '{"item":"Product","amount":"Revenue"}'},
    )
    assert first.status_code == second.status_code == 200
    first_insights = first.json()["insights"]
    second_insights = second.json()["insights"]
    assert any("Old Product" in item["explanation"] for item in first_insights)
    assert any("New Product" in item["explanation"] for item in second_insights)
    assert not any("Old Product" in item["explanation"] for item in second_insights)


def test_invalid_dates_and_numeric_values_do_not_create_unsupported_findings():
    upload = (
        "invalid.csv",
        b"Date,Product,Revenue,Cost\nbad-date,Alpha,not-a-number,not-a-cost\nalso-bad,Beta,also-invalid,still-invalid\n",
        "text/csv",
    )
    response = client.post(
        "/api/analyze",
        files={"file": upload},
        data={"category": "retail", "mappings": '{"date":"Date","item":"Product","amount":"Revenue","cost":"Cost"}'},
    )
    assert response.status_code == 200
    result = response.json()
    assert not any(item["id"] in {"monthly-trend", "period-over-period-change", "highest-performing-segment"} for item in result["insights"])
    assert any("could not be read as numbers" in warning for warning in result["qualityNotes"])
    assert any("missing or ambiguous date" in warning for warning in result["qualityNotes"])
    assert any(item["id"] == "check-revenue-values" for item in result["recommendations"])
    assert any(item["id"] == "check-trend-values" for item in result["recommendations"])
    assert any(item["id"] == "check-cost-values" for item in result["recommendations"])


def test_empty_dataset_produces_no_insights_and_requests_data_rows():
    dataset = Dataset(
        file_name="empty.csv",
        columns=["Date", "Revenue"],
        rows=[],
        empty_rows=0,
        duplicate_rows=0,
        missing_values=0,
        warnings=[],
        inferred_types={"Date": "empty", "Revenue": "empty"},
    )
    result = analyze_dataset(dataset, "retail", {"date": "Date", "amount": "Revenue"})
    assert result["insights"] == []
    assert result["recommendations"] == [{
        "id": "upload-data-rows",
        "title": "Add data rows",
        "action": "Potential action: upload a dataset with transaction or business activity rows to generate evidence-based insights.",
        "basis": "The active dataset contains no data rows.",
    }]


def test_invalid_file_type_and_empty_file_have_clear_http_errors():
    unsupported = client.post("/api/preview", files={"file": ("sales.txt", b"no", "text/plain")})
    assert unsupported.status_code == 415
    empty = client.post("/api/preview", files={"file": ("empty.csv", b"", "text/csv")})
    assert empty.status_code == 422
    assert "empty" in empty.json()["detail"].lower()


def test_malformed_csv_is_rejected_but_wrong_width_rows_are_retained_with_warning():
    malformed = client.post(
        "/api/preview",
        files={"file": ("broken.csv", b'Name,Amount\n"unclosed,10\n', "text/csv")},
    )
    assert malformed.status_code == 422

    uneven = client.post(
        "/api/preview",
        files={"file": ("uneven.csv", b"Name,Amount\nTea,10,extra\nCoffee\n", "text/csv")},
    )
    assert uneven.status_code == 200
    result = uneven.json()
    assert result["rowCount"] == 2
    assert result["columnCount"] == 3
    assert "do not match" in " ".join(result["warnings"])


def test_mappings_are_validated_and_order_total_conflicts_are_not_summed():
    invalid_mapping = client.post(
        "/api/analyze",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": '{"amount":"Not a column"}'},
    )
    assert invalid_mapping.status_code == 422

    conflict_file = ("orders.csv", b"Order ID,Revenue\nA,100\nA,200\n", "text/csv")
    conflict = client.post(
        "/api/analyze",
        files={"file": conflict_file},
        data={
            "category": "retail",
            "mappings": '{"amount":"Revenue","orderId":"Order ID"}',
            "aggregation": "order",
        },
    )
    assert conflict.status_code == 200
    revenue = next(item for item in conflict.json()["metrics"] if item["label"] == "Total revenue")
    assert revenue["unavailable"] is True
    assert "different mapped amounts" in revenue["detail"]


def test_category_specific_mappings_are_rejected():
    response = client.post(
        "/api/analyze",
        files={"file": _csv_upload()},
        data={"category": "retail", "mappings": '{"campaignSpend":"Revenue"}'},
    )
    assert response.status_code == 422
    assert "not available" in response.json()["detail"]


def test_invalid_numeric_values_and_duplicate_records_are_disclosed():
    rows = b"Date,Revenue,Order ID\n2026-01-01,not-money,A\n2026-01-01,10,B\n2026-01-01,10,B\n"
    response = client.post(
        "/api/analyze",
        files={"file": ("quality.csv", rows, "text/csv")},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue","orderId":"Order ID"}'},
    )
    assert response.status_code == 200
    result = response.json()
    revenue = next(item for item in result["metrics"] if item["label"] == "Total revenue")
    assert revenue["value"] == "20"
    assert result["dataQuality"]["duplicateRows"] == 1
    assert any("could not be read as numbers" in warning for warning in result["qualityNotes"])


def test_order_aggregation_deduplicates_repeated_totals():
    upload = ("orders.csv", b"Date,Order ID,Revenue\n2026-01-01,A,100\n2026-01-02,A,100\n2026-02-01,B,50\n", "text/csv")
    response = client.post(
        "/api/analyze",
        files={"file": upload},
        data={"category": "retail", "mappings": '{"date":"Date","amount":"Revenue","orderId":"Order ID"}', "aggregation": "order"},
    )
    assert response.status_code == 200
    result = response.json()
    revenue = next(item for item in result["metrics"] if item["label"] == "Total revenue")
    assert revenue["value"] == "150"
    assert result["trend"] == [{"label": "Jan 26", "value": 100}, {"label": "Feb 26", "value": 50}]


def test_upload_size_limit_is_enforced(monkeypatch):
    monkeypatch.setattr(api_module, "MAX_UPLOAD_BYTES", 8)
    response = client.post(
        "/api/preview",
        files={"file": ("large.csv", b"Name,Revenue\nTea,100\n", "text/csv")},
    )
    assert response.status_code == 413


def test_marketing_metrics_use_only_marketing_semantics():
    response = client.post(
        "/api/analyze",
        files={"file": ("campaign.csv", b"Spend,Leads,Conversions,Attributed Revenue\n100,20,5,300\n", "text/csv")},
        data={
            "category": "marketing",
            "mappings": '{"campaignSpend":"Spend","leads":"Leads","conversions":"Conversions","amount":"Attributed Revenue"}',
        },
    )
    assert response.status_code == 200
    metrics = {metric["label"]: metric for metric in response.json()["metrics"]}
    assert metrics["Campaign spending"]["value"] == "100"
    assert metrics["Cost per lead"]["value"] == "5"
    assert metrics["Conversion rate"]["value"] == "25%"
    assert metrics["Campaign ROI"]["value"] == "200%"


def test_logistics_metrics_use_shipments_and_date_pairs():
    response = client.post(
        "/api/analyze",
        files={"file": ("delivery.csv", b"Shipment ID,Date,Delivered date,Expected delivery date,Delivery cost,Region\nA,2026-01-01,2026-01-03,2026-01-04,10,North\nB,2026-01-02,2026-01-05,2026-01-04,15,South\n", "text/csv")},
        data={
            "category": "logistics",
            "mappings": '{"shipmentId":"Shipment ID","date":"Date","deliveryDate":"Delivered date","expectedDate":"Expected delivery date","deliveryCost":"Delivery cost","region":"Region"}',
        },
    )
    assert response.status_code == 200
    metrics = {metric["label"]: metric for metric in response.json()["metrics"]}
    assert metrics["Total shipments"]["value"] == "2"
    assert metrics["Average delivery time"]["value"] == "2.5"
    assert metrics["On-time delivery"]["value"] == "50%"
