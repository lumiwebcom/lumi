@echo off
title Lumi
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto oldnode

echo Getting Lumi ready (the first time takes about a minute)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  Setup failed. Take a screenshot of this window and send it to Claude.
  pause
  exit /b
)

echo.
echo  Starting Lumi... your browser will open in a moment.
echo  Keep this window open while you use Lumi. Close it to turn Lumi off.
echo.
set LUMI_OPEN=1
node --no-warnings server.js
echo.
echo  Lumi stopped. If you see an error above, take a screenshot and send it to Claude.
pause
exit /b

:nonode
echo.
echo  Node.js is not installed. Opening nodejs.org...
echo  Download the LTS version, install it, restart your PC, then run Start Lumi again.
start "" https://nodejs.org
pause
exit /b

:oldnode
for /f %%v in ('node -v') do set NODEV=%%v
echo.
echo  Your Node.js is too old (%NODEV%). Lumi needs version 22.13 or newer.
echo  Opening nodejs.org - install the LTS version, restart your PC, then run Start Lumi again.
start "" https://nodejs.org
pause
exit /b
