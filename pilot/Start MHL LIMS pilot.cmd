@echo off
title MHL LIMS pilot
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(+process.versions.node.split('.')[0] >= 18 ? 0 : 1)"
if errorlevel 1 goto oldnode
echo Starting the MHL LIMS pilot. Your browser will open in a moment.
echo Keep this window open while you use the pilot; close it to stop.
node server.mjs --open
pause
exit /b 0
:nonode
echo Node.js was not found on this computer.
echo Install Node.js 18 or later (nodejs.org), or open dist\MHL-LIMS-pilot-standalone.html in your browser instead.
pause
exit /b 1
:oldnode
echo This pilot needs Node.js 18 or later. Your version is:
node --version
echo You can also open dist\MHL-LIMS-pilot-standalone.html in your browser instead.
pause
exit /b 1
