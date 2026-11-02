# Business Insight Studio API

The local FastAPI service validates CSV/XLSX uploads, produces bounded previews, and calculates category-specific analytics. Uploaded files are processed in memory; the application does not persist them or log row contents. Uvicorn should bind to `127.0.0.1` for local development.

## Start and stop the application

From `E:\B_I_S`, run `.\Start_BIS.bat` or double-click `Start_BIS.bat`. It opens separate terminal windows for the backend (`127.0.0.1:8000`) and frontend (`127.0.0.1:5173`), using the existing backend virtual environment and npm lockfile install. The launcher does not install dependencies. If it reports missing dependencies, follow the setup steps below (`python -m pip install -r requirements.txt` for the backend; `npm.cmd ci` from `E:\B_I_S\frontend` for the frontend).

Stop each server with `Ctrl+C` in its terminal window, then close the windows. The frontend API URL is persisted in `frontend\.env` as `http://127.0.0.1:8000`.

## Windows PowerShell setup

```powershell
Set-Location E:\B_I_S\backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

If PowerShell blocks activation, allow activation for the current terminal with `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then activate the environment. The backend loads `backend\.env` when it starts.

To run tests, open another PowerShell terminal:

```powershell
Set-Location E:\B_I_S\backend
.\.venv\Scripts\Activate.ps1
python -m pytest -q
```

## Frontend connection

In another terminal:

```powershell
Set-Location E:\B_I_S\frontend
Copy-Item .env.example .env
npm.cmd run dev
```

Vite reads `VITE_API_BASE_URL` from `frontend\.env`; restart Vite after changing it. The default backend URL is `http://127.0.0.1:8000`. Configure CORS in `backend\.env` with local Vite origins on port 5173 for development, or exact HTTPS frontend origins for a hosted deployment. Wildcards, non-local HTTP origins, paths, and credentials are rejected. Never point the frontend at an untrusted API: uploads are sent to the configured URL.

## Endpoints

Responses are JSON except for the PDF report endpoint. Interactive OpenAPI documentation is available at `http://127.0.0.1:8000/docs`.

### `GET /api/health`

Returns `{"status":"ok","service":"business-insight-studio"}`.

### `GET /api/categories`

Returns supported category IDs, labels, and semantic fields.

### `POST /api/preview`

Multipart form field: `file` (CSV or XLSX, up to the configured upload limit). Returns filename, headers and inferred types, at most eight sample rows, row/column counts, missing values, exact duplicates, and parser warnings.

### `POST /api/analyze`

Multipart form fields:

- `file`: CSV or XLSX upload.
- `category`: one of `retail`, `ecommerce`, `restaurant`, `manufacturing`, `marketing`, or `logistics`.
- `mappings`: JSON object from supported semantic field IDs to uploaded column names; omitted mappings are allowed.
- `range`: optional `all`, `30`, or `90` (default `all`).
- `aggregation`: optional `row` or `order` (default `row`).

Returns metrics with calculation details and availability flags, trend and breakdown series, comparable adjacent-month growth when possible, structured dataset-grounded `insights` and clearly labeled potential `recommendations`, quality warnings, scope counts, and preview metadata. Insights reuse the analyzed metric, trend, and segment totals; missing fields and incomplete period coverage are not guessed. In order-total mode, inconsistent totals, missing order IDs, ambiguous segment allocations, and unconfirmed cost granularity are reported instead of guessed.

HTTP errors use `detail` messages: `413` for oversized files, `415` for unsupported formats, and `422` for malformed or invalid data, mappings, categories, or calculation options.

### `POST /api/report`

Accepts the same multipart fields as `/api/analyze` and returns a downloadable `application/pdf` attachment. The report calls the shared analytics engine for its metrics, trends, insights, and recommendations; the selected date range and active mappings are applied to that upload. The PDF includes a branded cover, executive summary, dataset overview, available KPIs, supported performance analysis, insights, potential actions, and data-quality limitations. Empty datasets, invalid uploads, and invalid mappings return the same explicit HTTP errors as analysis.

### `POST /api/assistant`

Accepts `file`, `category`, `mappings`, `range`, `aggregation`, and a required question of at most 500 characters. Returns a deterministic `{question, answer, kind}` response based only on the uploaded file and the same analytics engine used by `/api/analyze`. Unsupported questions and missing mapped fields receive clear notices; malformed uploads, invalid mappings, and invalid options return HTTP errors. The assistant does not call an external AI service.

## Configuration

`backend\.env.example` contains non-secret development settings:

- `BIS_ALLOWED_ORIGINS`: comma-separated local Vite origins on port 5173 and/or explicit HTTPS frontend origins. No wildcard origins.
- `BIS_MAX_UPLOAD_BYTES`: maximum request file size (default 20 MiB).

No database, model, authentication, public binding, or third-party analytics service is configured by the local launcher.
