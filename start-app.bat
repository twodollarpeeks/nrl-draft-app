@echo off
rem Double-click to run NRL Draft on this computer: starts the API and the
rem website, then opens http://localhost:5173. Close this window to stop it.
title NRL Draft (close this window to stop)
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get it from https://nodejs.org, then try again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo The .env file is missing, so the app can't reach the database.
  echo See "Environment variables" in README.md.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing packages. This takes a minute or two...
  call npm install
  if errorlevel 1 (
    echo Installing failed. Scroll up to see why.
    pause
    exit /b 1
  )
)

rem Open the browser once the servers have had a few seconds to start.
start "" /b cmd /c "timeout /t 6 /nobreak >nul && start "" http://localhost:5173"

echo Starting NRL Draft. Your browser opens at http://localhost:5173
echo Close this window to stop the app.
echo.
call npm run dev

rem Only reached if the servers stop by themselves (for example an error).
echo.
echo The app stopped. Scroll up to see why.
pause
