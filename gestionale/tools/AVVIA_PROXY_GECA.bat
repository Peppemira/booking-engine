@echo off
title GECA Intel — Proxy Cattura (porta 8888)
color 0A
echo.
echo  =========================================
echo   GECA Intel - Proxy HTTP/HTTPS su :8888
echo  =========================================
echo.
echo  Questo proxy intercetta le chiamate di GeCA
echo  verso il Portale dell'Automobilista e le
echo  salva in C:\analisi-geca\catture\geca\
echo.
echo  IMPORTANTE: GeCA deve essere configurato
echo  per usare il proxy 127.0.0.1:8888
echo  (usa "Configura Proxy" nel pannello HTA)
echo.
echo  Premi CTRL+C per fermare il proxy.
echo  =========================================
echo.

REM Controlla se mitmdump e' disponibile
where mitmdump >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] mitmdump non trovato nel PATH.
    echo.
    echo  Installalo con:  pip install mitmproxy
    echo.
    pause
    exit /b 1
)

REM Avvia mitmdump con l'addon GECA Intel
set TOOLS_DIR=%~dp0
set ADDON=%TOOLS_DIR%geca_mitm_addon.py

echo  Addon: %ADDON%
echo  Porta: 8888
echo.
echo  In attesa di traffico da GeCA...
echo.

mitmdump -p 8888 -s "%ADDON%" --ssl-insecure --quiet

pause
