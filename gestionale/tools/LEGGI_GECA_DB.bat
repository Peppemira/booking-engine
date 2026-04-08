@echo off
chcp 65001 > nul
echo ========================================
echo   GECA MySQL Reader - Lettura Database
echo ========================================
echo.

cd /d "%~dp0"

REM Verifica Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRORE] Python non trovato nel PATH.
    echo Installa Python da python.org e riprova.
    pause
    exit /b 1
)

REM Installa mysql-connector-python se mancante
python -c "import mysql.connector" >nul 2>nul
if %errorlevel% neq 0 (
    echo Installazione mysql-connector-python...
    pip install mysql-connector-python --quiet
)

echo Lettura database GeCA in corso...
echo.
python geca_mysql_reader.py

echo.
echo ========================================
echo Completato! I file JSON sono in:
echo %~dp0geca-export\
echo ========================================
pause
