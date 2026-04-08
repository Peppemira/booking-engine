@echo off
title BLUEFOX Gestionale
color 0A

echo.
echo  BLUEFOX S.R.L. - Gestionale Autoscuola
echo  =========================================
echo.

:: Verifica Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato. Scaricalo da https://nodejs.org
    pause
    exit /b 1
)

:: Verifica .env
if not exist "%~dp0backend\.env" (
    echo [ERRORE] File backend\.env non trovato.
    pause
    exit /b 1
)

:: Installa dipendenze backend se mancanti
if not exist "%~dp0backend\node_modules" (
    echo [INFO] Installazione dipendenze backend...
    cd /d "%~dp0backend"
    call npm install
)

:: Installa dipendenze frontend se mancanti
if not exist "%~dp0frontend\node_modules" (
    echo [INFO] Installazione dipendenze frontend...
    cd /d "%~dp0frontend"
    call npm install
)

echo.
echo [1/2] Avvio Backend su http://localhost:3000 ...
start "%~dp0avvia_backend.bat"

timeout /t 4 /nobreak >nul

echo [2/2] Avvio Frontend su http://localhost:3001 ...
start "%~dp0avvia_frontend.bat"

timeout /t 12 /nobreak >nul

echo Apertura browser...
start "" http://localhost:3001

echo.
echo  Gestionale avviato!
echo  Backend:  http://localhost:3000
echo  Frontend: http://localhost:3001
echo.
pause
