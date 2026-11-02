from __future__ import annotations

import io
import json
import os
import re
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .analytics import CATEGORIES, FIELD_LABELS, analyze_dataset
from .assistant import MAX_QUESTION_LENGTH, answer_dataset_question
from .data import PREVIEW_ROWS, SUPPORTED_EXTENSIONS, Dataset, parse_dataset
from .reports import generate_business_report_pdf

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _max_upload_bytes() -> int:
    value = os.getenv("BIS_MAX_UPLOAD_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES))
    try:
        parsed = int(value)
    except ValueError as error:
        raise RuntimeError("BIS_MAX_UPLOAD_BYTES must be an integer.") from error
    if parsed < 1:
        raise RuntimeError("BIS_MAX_UPLOAD_BYTES must be greater than zero.")
    return parsed


def _allowed_origins() -> list[str]:
    configured = os.getenv(
        "BIS_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    )
    origins: list[str] = []
    for candidate in configured.split(","):
        origin = candidate.strip().rstrip("/")
        if not origin:
            continue
        parsed = urlparse(origin)
        try:
            port = parsed.port
        except ValueError as error:
            raise RuntimeError("BIS_ALLOWED_ORIGINS contains an invalid port.") from error
        local_origin = (
            parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1"}
            and port == 5173
        )
        production_origin = (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and "*" not in parsed.hostname
        )
        if (
            not (local_origin or production_origin)
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError(
                "BIS_ALLOWED_ORIGINS must contain local Vite origins on port 5173 "
                "or explicit HTTPS origins without paths or credentials."
            )
        hostname = parsed.hostname.lower() if parsed.hostname else ""
        if ":" in hostname:
            hostname = f"[{hostname}]"
        normalized_port = f":{port}" if port and not (parsed.scheme == "https" and port == 443) else ""
        origins.append(f"{parsed.scheme.lower()}://{hostname}{normalized_port}")
    return list(dict.fromkeys(origins))


MAX_UPLOAD_BYTES = _max_upload_bytes()
ALLOWED_ORIGINS = _allowed_origins()

app = FastAPI(
    title="Business Insight Studio API",
    version="0.1.0",
    description="In-memory dataset preview, business analytics, assistant, and PDF report endpoints.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "business-insight-studio"}


@app.get("/api/categories")
async def categories() -> dict[str, list[dict[str, Any]]]:
    return {
        "categories": [
            {
                "id": category_id,
                "name": config["name"],
                "fields": [
                    {"id": field, "label": FIELD_LABELS[field]}
                    for field in config["fields"]
                ],
            }
            for category_id, config in CATEGORIES.items()
        ]
    }


async def _read_and_parse(file: UploadFile) -> Dataset:
    try:
        extension = "." + file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else ""
        if extension not in SUPPORTED_EXTENSIONS:
            raise HTTPException(status_code=415, detail="Unsupported file format. Choose a CSV or XLSX file.")
        content = bytearray()
        while chunk := await file.read(64 * 1024):
            content.extend(chunk)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.")
        try:
            return parse_dataset(file.filename or "uploaded-dataset", bytes(content))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        await file.close()


def _preview(dataset: Dataset) -> dict[str, Any]:
    return {
        "fileName": dataset.file_name,
        "columns": [
            {"name": column, "inferredType": dataset.inferred_types[column]}
            for column in dataset.columns
        ],
        "sampleRows": dataset.rows[:PREVIEW_ROWS],
        "rowCount": len(dataset.rows),
        "columnCount": len(dataset.columns),
        "missingValues": dataset.missing_values,
        "emptyRows": dataset.empty_rows,
        "duplicateRows": dataset.duplicate_rows,
        "warnings": dataset.warnings,
    }


def _parse_mappings(mappings: str) -> dict[str, str]:
    try:
        parsed_mappings = json.loads(mappings)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="Mappings must be a JSON object of semantic fields to uploaded column names.") from error
    if not isinstance(parsed_mappings, dict) or any(
        not isinstance(field, str) or not isinstance(column, str) or not column
        for field, column in parsed_mappings.items()
    ):
        raise HTTPException(status_code=422, detail="Mappings must be a JSON object of semantic fields to non-empty column names.")
    return parsed_mappings


@app.post("/api/preview")
async def preview(file: UploadFile = File(...)) -> dict[str, Any]:
    dataset = await _read_and_parse(file)
    return _preview(dataset)


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    category: str = Form(...),
    mappings: str = Form("{}"),
    date_range: str = Form("all", alias="range"),
    aggregation: str = Form("row"),
) -> dict[str, Any]:
    dataset = await _read_and_parse(file)
    if category not in CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Unsupported business category “{category}”.")
    parsed_mappings = _parse_mappings(mappings)
    try:
        analytics = analyze_dataset(dataset, category, parsed_mappings, date_range, aggregation)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {**analytics, "dataQuality": _preview(dataset)}


@app.post("/api/assistant")
async def assistant(
    file: UploadFile = File(...),
    category: str = Form(...),
    question: str = Form(..., min_length=1, max_length=MAX_QUESTION_LENGTH),
    mappings: str = Form("{}"),
    date_range: str = Form("all", alias="range"),
    aggregation: str = Form("row"),
) -> dict[str, str]:
    dataset = await _read_and_parse(file)
    if category not in CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Unsupported business category “{category}”.")
    parsed_mappings = _parse_mappings(mappings)
    try:
        answer = answer_dataset_question(question, dataset, category, parsed_mappings, date_range, aggregation)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"question": question.strip(), **answer}


@app.post("/api/report")
async def report(
    file: UploadFile = File(...),
    category: str = Form(...),
    mappings: str = Form("{}"),
    date_range: str = Form("all", alias="range"),
    aggregation: str = Form("row"),
) -> StreamingResponse:
    dataset = await _read_and_parse(file)
    if category not in CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Unsupported business category “{category}”.")
    parsed_mappings = _parse_mappings(mappings)
    try:
        analytics = analyze_dataset(dataset, category, parsed_mappings, date_range, aggregation)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    pdf = generate_business_report_pdf(
        dataset,
        CATEGORIES[category]["name"],
        category,
        parsed_mappings,
        date_range,
        analytics,
    )
    file_base = re.sub(r"[^A-Za-z0-9._-]+", "-", dataset.file_name.rsplit(".", 1)[0]).strip("-.") or "dataset"
    filename = f"{category}-{file_base}-business-report.pdf"
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
