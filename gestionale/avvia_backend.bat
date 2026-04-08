@echo off
title Backend BLUEFOX :3000
cd /d "%~dp0backend"
echo.
echo  Backend BLUEFOX - http://localhost:3000
echo  Lascia questa finestra aperta.
echo.
node src\server.js
pause
