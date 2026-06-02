@echo off
cd /d "%~dp0"
echo Building Radio Bot...
call npm run build
if errorlevel 1 (
  echo Build failed. Bot was not started.
  pause
  exit /b 1
)

echo Starting Radio Bot...
npm start
pause
