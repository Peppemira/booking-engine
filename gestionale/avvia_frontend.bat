@echo off
title Frontend BLUEFOX :3001
color 0A

echo.
echo  ================================
echo   BLUEFOX - Frontend :3001
echo  ================================
echo.

:: IMPORTANTE: Avvia sempre dal percorso REALE (C:\Users\bluef\)
:: non dal symlink D:\ per evitare il bug di Next.js 16 Turbopack
:: con i percorsi triplicati.

set REAL_PATH=C:\Users\bluef\booking-engine\gestionale\frontend

if exist "%REAL_PATH%\package.json" (
    cd /d "%REAL_PATH%"
) else (
    :: Fallback al percorso relativo allo script
    cd /d "%~dp0frontend"
)

echo  Cartella: %CD%
echo  Avvio Next.js su http://localhost:3001
echo  Aspetta: Ready on http://localhost:3001
echo.

:: Cancella la cache .next prima di avviare
if exist ".next" (
    echo  Pulizia cache .next...
    rmdir /s /q ".next" 2>nul
)

npm run dev

echo.
echo  --- Server fermato ---
pause
