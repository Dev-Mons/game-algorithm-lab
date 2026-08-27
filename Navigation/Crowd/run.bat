@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or is not available in PATH.
    echo Install Node.js 20.19 or newer, then run this file again.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not available in PATH.
    pause
    exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo Starting Crowd Navigation Lab...
echo Press Ctrl+C to stop the server.
call npm run dev -- --open

if errorlevel 1 (
    echo [ERROR] The development server stopped with an error.
    pause
    exit /b 1
)

endlocal
