@echo off
chcp 65001 > nul
echo ============================================
echo   GECA Access Reader - Lettura Database MDB
echo ============================================
echo.
cd /d "%~dp0"
python geca_access_reader.py --export
echo.
pause
