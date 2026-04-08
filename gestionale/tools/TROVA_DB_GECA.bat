@echo off
chcp 65001 > nul
echo ============================================
echo  Ricerca Database GeCA - Discovery completo
echo ============================================
echo.
python "%~dp0trova_db_geca.py"
pause
