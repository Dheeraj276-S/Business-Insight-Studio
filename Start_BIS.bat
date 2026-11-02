@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
    echo Backend virtual environment was not found: "%PYTHON%"
    echo Create it with: py -3.13 -m venv "%BACKEND%\.venv"
    echo Then install backend dependencies with:
    echo "%PYTHON%" -m pip install -r "%BACKEND%\requirements.txt"
    pause
    exit /b 1
)

"%PYTHON%" -c "import fastapi, uvicorn" >nul 2>nul
if errorlevel 1 (
    echo Backend dependencies are missing from backend\.venv.
    echo Install them with:
    echo "%PYTHON%" -m pip install -r "%BACKEND%\requirements.txt"
    pause
    exit /b 1
)

if not exist "%FRONTEND%\node_modules\vite\bin\vite.js" (
    echo Frontend dependencies are not installed.
    echo From "%FRONTEND%", run: npm.cmd ci
    pause
    exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo npm.cmd was not found. Install Node.js, then reopen this terminal.
    pause
    exit /b 1
)

if not exist "%FRONTEND%\.env" (
    echo Frontend configuration was not found: "%FRONTEND%\.env"
    echo Set VITE_API_BASE_URL=http://127.0.0.1:8000 in that file, then restart this launcher.
    pause
    exit /b 1
)

findstr /x /c:"VITE_API_BASE_URL=http://127.0.0.1:8000" "%FRONTEND%\.env" >nul
if errorlevel 1 (
    echo frontend\.env must contain exactly:
    echo VITE_API_BASE_URL=http://127.0.0.1:8000
    echo Update the file, then restart this launcher.
    pause
    exit /b 1
)

start "Business Insight Studio - Backend" /D "%BACKEND%" cmd.exe /k ""%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
if errorlevel 1 (
    echo Could not open the backend terminal.
    pause
    exit /b 1
)

start "Business Insight Studio - Frontend" /D "%FRONTEND%" cmd.exe /k "npm.cmd run dev -- --host 127.0.0.1 --strictPort"
if errorlevel 1 (
    echo Could not open the frontend terminal.
    pause
    exit /b 1
)

echo Started backend at http://127.0.0.1:8000 and frontend at http://127.0.0.1:5173.
endlocal
