@echo off
title GECA Intel — Proxy Autonomo :8888
color 0A

echo.
echo  =====================================================
echo   GECA Intel - Proxy Autonomo
echo   (nessun Fiddler, nessun certificato necessario)
echo  =====================================================
echo.
echo  Chiudo Fiddler se e' in esecuzione...
taskkill /IM Fiddler.exe /F >nul 2>&1
echo  (se Fiddler non era aperto, va bene lo stesso)
echo.
timeout /t 2 /nobreak >nul

echo  Avvio proxy su porta 8888...
echo.
cd /d "%~dp0"
python "%~dp0geca_proxy_server.py"

pause
