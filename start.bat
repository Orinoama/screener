@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (
    echo npm not found. Install Node.js: https://nodejs.org
    pause
    exit /b 1
)
if not exist node_modules (
    echo Installing dependencies...
    npm install
)
echo Starting dev server on http://localhost:3000
npm run dev
pause
