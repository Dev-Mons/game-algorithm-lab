@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 goto :failed

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or is not available in PATH.
    echo Install Node.js 22.12 or newer, then run this file again.
    goto :failed
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22 ? 0 : 1)"
if errorlevel 1 (
    echo [ERROR] This project requires Node.js 20.19 or 22.12 or newer supported releases.
    goto :failed
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not available in PATH. Reinstall Node.js with npm.
    goto :failed
)

if not exist "node_modules\.bin\vite.cmd" (
    echo Installing project dependencies...
    call npm ci
    if errorlevel 1 goto :failed
)

echo Starting Form and Field - Level Generation Lab...
echo The browser will open automatically. Keep this window open while using the app.
echo Press Ctrl+C to stop the server.
call npm run dev -- --open %*
if errorlevel 1 goto :failed
exit /b 0

:failed
echo [ERROR] Could not start the app. See the message above.
pause
exit /b 1
