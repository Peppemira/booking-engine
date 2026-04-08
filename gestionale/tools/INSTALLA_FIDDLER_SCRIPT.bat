@echo off
chcp 65001 > nul
echo ============================================
echo  Installa FiddlerScript per GECA Intel
echo ============================================
echo.
python "%~dp0installa_fiddler_script.py"
echo.
echo Ora in Fiddler: Rules > Reload Scripts (o riavvia Fiddler)
echo Le chiamate di GeCA verranno salvate automaticamente in GECA Intel.
echo.
pause
