@echo off
chcp 65001 > nul
echo Ripristino GeCA (rimozione proxy)...
python "%~dp0ripristina_geca.py"
pause
