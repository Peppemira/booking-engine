@echo off
chcp 65001 > nul
echo ============================================
echo  Ricerca Database principale GeCA (estesa)
echo ============================================
echo.
python "%~dp0trova_db_principale.py"
pause
