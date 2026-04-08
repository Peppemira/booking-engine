@echo off
chcp 65001 > nul
echo ============================================
echo  CATTURA CHIAMATE HTTP DI GECA (via Fiddler)
echo ============================================
echo.
echo Fiddler si apre da solo, cattura il traffico
echo di GeCA e quando lo chiudi salva tutto in JSON.
echo.
echo PASSI:
echo  1. Questo script apre Fiddler
echo  2. Usa GeCA normalmente (apri candidati, pratiche, ecc.)
echo  3. Vai sul Portale dell'Automobilista
echo  4. Quando hai finito: File ^> Save ^> All Sessions
echo     Salva il file .saz nella cartella geca-export\
echo  5. Poi esegui: python geca_parse_fiddler.py
echo.

set FIDDLER_PATH=C:\Users\bluef\AppData\Local\Programs\Fiddler\Fiddler.exe
set FIDDLER2_PATH=C:\Program Files\Telerik\Fiddler\Fiddler.exe
set FIDDLER3_PATH=C:\Program Files (x86)\Telerik\Fiddler\Fiddler.exe

if exist "%FIDDLER_PATH%" (
    echo Apertura Fiddler...
    start "" "%FIDDLER_PATH%"
    goto :fiddler_found
)
if exist "%FIDDLER2_PATH%" (
    echo Apertura Fiddler...
    start "" "%FIDDLER2_PATH%"
    goto :fiddler_found
)
if exist "%FIDDLER3_PATH%" (
    echo Apertura Fiddler...
    start "" "%FIDDLER3_PATH%"
    goto :fiddler_found
)

echo [ATTENZIONE] Fiddler non trovato nei percorsi standard.
echo Aprilo manualmente cercando "Fiddler" nel menu Start.

:fiddler_found
echo.
echo Fiddler e' aperto. Ora:
echo  1. In Fiddler, vai su Tools ^> Options ^> HTTPS
echo     e attiva "Decrypt HTTPS traffic" (solo la prima volta)
echo  2. Usa GeCA normalmente
echo  3. File ^> Save ^> All Sessions -> salva in geca-export\
echo.
echo Premi INVIO quando hai finito di catturare...
pause > nul

echo.
echo Analisi del file catturato in corso...
python "%~dp0geca_parse_fiddler.py"
pause
