from __future__ import annotations

import csv
import io
import json
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

MAX_ROWS = 100_000
PREVIEW_ROWS = 8
SUPPORTED_EXTENSIONS = {".csv", ".xlsx"}


@dataclass(frozen=True)
class Dataset:
    file_name: str
    columns: list[str]
    rows: list[dict[str, Any]]
    empty_rows: int
    duplicate_rows: int
    missing_values: int
    warnings: list[str]
    inferred_types: dict[str, str]


def json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _headers(values: list[Any], width: int, warnings: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    counts: Counter[str] = Counter()
    for index in range(width):
        raw = values[index] if index < len(values) else None
        base = str(raw).strip() if raw is not None and str(raw).strip() else f"Column {index + 1}"
        if raw is None or not str(raw).strip():
            warnings.append(f"Column {index + 1} has no header; it is labeled “{base}”.")
        counts[base] += 1
        name = base if counts[base] == 1 else f"{base} ({counts[base]})"
        while name in seen:
            counts[base] += 1
            name = f"{base} ({counts[base]})"
        if name != base:
            warnings.append(f"Duplicate header “{base}” was renamed “{name}” so both columns remain available.")
        seen.add(name)
        result.append(name)
    return result


def _is_empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _infer_type(values: list[Any]) -> str:
    non_empty = [value for value in values if not _is_empty(value)]
    if not non_empty:
        return "empty"
    if all(isinstance(value, bool) for value in non_empty):
        return "boolean"
    if all(isinstance(value, (date, datetime)) for value in non_empty):
        return "date"
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in non_empty):
        return "number"

    from .analytics import parse_date, parse_number

    text_values = [str(value).strip() for value in non_empty]
    if all(parse_date(value) is not None for value in text_values):
        return "date"
    if all(parse_number(value) is not None for value in text_values):
        return "number"
    recognized = [
        isinstance(value, bool)
        or parse_date(value) is not None
        or parse_number(value) is not None
        for value in text_values
    ]
    return "mixed" if any(recognized) else "text"


def _build_dataset(file_name: str, raw_rows: list[list[Any]]) -> Dataset:
    if not raw_rows or not any(not _is_empty(cell) for cell in raw_rows[0]):
        raise ValueError("No column headers were found. Add a header row and try again.")

    header_width = len(raw_rows[0])
    width = max((len(row) for row in raw_rows), default=0)
    if width > 512:
        raise ValueError("This file has more than 512 columns. Remove unused columns and try again.")
    warnings: list[str] = []
    columns = _headers(raw_rows[0], width, warnings)
    source_rows = raw_rows[1:]
    if len(source_rows) > MAX_ROWS:
        raise ValueError(f"This file has more than {MAX_ROWS:,} data rows. Split it into smaller files to avoid incomplete results.")

    malformed_rows = sum(
        1 for row in source_rows
        if any(not _is_empty(value) for value in row) and len(row) != header_width
    )
    rows = [
        {column: json_value(row[index] if index < len(row) else None) for index, column in enumerate(columns)}
        for row in source_rows
    ]
    empty_rows = sum(1 for row in rows if all(_is_empty(row[column]) for column in columns))
    duplicate_rows = len(rows) - len({
        json.dumps([row[column] for column in columns], ensure_ascii=False, sort_keys=True)
        for row in rows
    })
    missing_values = sum(
        1 for row in rows for column in columns if _is_empty(row[column])
    )
    if not rows or empty_rows == len(rows):
        raise ValueError("This file has column headers but no data rows to analyze.")
    if empty_rows:
        warnings.append(f"{empty_rows} completely blank row(s) retained in the preview and excluded from calculations that need values.")
    if malformed_rows:
        warnings.append(
            f"{malformed_rows:,} non-empty row(s) do not match the {header_width:,} header columns. "
            "Short rows are padded with blanks, and extra cells are retained in generated columns."
        )
    if duplicate_rows:
        warnings.append(f"{duplicate_rows:,} exact duplicate row(s) detected. Duplicates are retained and included in calculations.")
    inferred_types = {
        column: _infer_type([row[column] for row in rows])
        for column in columns
    }
    return Dataset(
        file_name=file_name,
        columns=columns,
        rows=rows,
        empty_rows=empty_rows,
        duplicate_rows=duplicate_rows,
        missing_values=missing_values,
        warnings=list(dict.fromkeys(warnings)),
        inferred_types=inferred_types,
    )


def parse_dataset(file_name: str, content: bytes) -> Dataset:
    extension = Path(file_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError("Unsupported file format. Choose a CSV or XLSX file.")
    if not content:
        raise ValueError("This file is empty. Choose a CSV or Excel file with column headers and data rows.")

    if extension == ".csv":
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("This CSV is not valid UTF-8 text. Save it as UTF-8 CSV and try again.") from error
        try:
            sample = text[:8192]
            try:
                delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
            except csv.Error:
                delimiter = ","
            reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
            raw_rows = [list(row) for row in reader]
        except csv.Error as error:
            raise ValueError("The CSV is malformed. Check its quoting and row delimiters, then try again.") from error
        return _build_dataset(file_name, raw_rows)

    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        try:
            sheet = workbook.active
            if sheet is None:
                raise ValueError("The spreadsheet contains no readable worksheet.")
            if sheet.max_column is not None and sheet.max_column > 512:
                raise ValueError("This spreadsheet has more than 512 columns. Remove unused columns and try again.")
            if sheet.max_row is not None and sheet.max_row > MAX_ROWS + 1:
                raise ValueError(f"This spreadsheet has more than {MAX_ROWS:,} data rows. Split it into smaller files to avoid incomplete results.")
            raw_rows = [list(row) for row in sheet.iter_rows(values_only=True)]
        finally:
            workbook.close()
        return _build_dataset(file_name, raw_rows)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("The spreadsheet could not be read. Check that the first sheet contains a valid XLSX table and try again.") from error
