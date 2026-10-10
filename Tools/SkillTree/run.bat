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

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if errorlevel 1 (
    echo [ERROR] This project requires Node.js 22.12 or newer.
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

title Skill Tree Studio
echo Starting Skill Tree Studio...
echo The browser will open automatically at the address shown below.
node scripts\start-dev.mjs %*
if errorlevel 1 goto :failed
exit /b 0

:failed
echo [ERROR] Could not start Skill Tree Studio. See the message above.
pause
exit /b 1
