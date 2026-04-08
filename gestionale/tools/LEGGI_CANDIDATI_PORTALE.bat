@echo off
title Portale Automobilista — Situazione Candidati
color 0B
echo.
echo  ================================================
echo   SITUAZIONE CANDIDATI — Portale Automobilista
echo  ================================================
echo.

REM Leggi username e password se non già impostati
set /p PORTALE_USER="  Username Portale: "
echo.
set /p PORTALE_PASS="  Password Portale: "
echo.
echo.
echo  Connessione al Portale...
echo.

cd /d "%~dp0"

REM --- Da Prenotare (Patente)
echo  [1/4] Candidati DA PRENOTARE - PATENTE
python "%~dp0portale_scraper.py" --user "%PORTALE_USER%" --password "%PORTALE_PASS%" --stato D --esame P
echo.

REM --- Da Prenotare (CQC)
echo  [2/4] Candidati DA PRENOTARE - CQC
python "%~dp0portale_scraper.py" --user "%PORTALE_USER%" --password "%PORTALE_PASS%" --stato D --esame Q
echo.

REM --- Prenotati (Patente)
echo  [3/4] Candidati PRENOTATI - PATENTE
python "%~dp0portale_scraper.py" --user "%PORTALE_USER%" --password "%PORTALE_PASS%" --stato P --esame P
echo.

REM --- Salva tutto in JSON
echo  [4/4] Salvataggio dati in JSON...
python "%~dp0portale_scraper.py" --user "%PORTALE_USER%" --password "%PORTALE_PASS%" --stato D --esame P --salva "%~dp0candidati_da_prenotare_patente.json" > nul
python "%~dp0portale_scraper.py" --user "%PORTALE_USER%" --password "%PORTALE_PASS%" --stato D --esame Q --salva "%~dp0candidati_da_prenotare_cqc.json" > nul
python "%~dp0portale_scraper.py" --user "%PORTALE_USER%" --password "%PORTALE_PASS%" --stato P --esame P --salva "%~dp0candidati_prenotati_patente.json" > nul
echo  JSON salvati nella cartella tools\

echo.
echo  ================================================
echo   Completato!
echo  ================================================
pause
