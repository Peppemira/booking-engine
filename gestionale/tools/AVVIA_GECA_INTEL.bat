@echo off
title GECA Intel — Avvio Completo
color 0A
echo.
echo  =====================================================
echo   GECA Intel — Avvio Completo (senza proxy sistema)
echo  =====================================================
echo.

REM Chiudi processi precedenti sulla porta 8888 e 8090
echo  Chiudo processi precedenti...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8888 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8090 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
REM Chiudi Fiddler se aperto
taskkill /IM Fiddler.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

REM Assicurati che il proxy di SISTEMA sia spento
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1

echo  Avvio server GECA Intel...
echo  (dashboard su http://localhost:8090/dashboard.html)
echo.
cd /d "%~dp0"
python "%~dp0geca_server_all.py"

pause
