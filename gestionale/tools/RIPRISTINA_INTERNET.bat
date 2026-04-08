@echo off
title Ripristino Internet e Proxy
color 0E
echo.
echo  ================================================
echo   RIPRISTINO COMPLETO PROXY E INTERNET
echo  ================================================
echo.

echo  [1/4] Rimuovo proxy di sistema (registro Windows)...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyOverride /f >nul 2>&1
reg add    "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1
echo      OK

echo  [2/4] Ripristino WinHTTP proxy...
netsh winhttp reset proxy >nul 2>&1
echo      OK

echo  [3/4] Ripristino configurazione GeCA (rimuovo proxy da GeCAFuture.exe.config)...
cd /d "%~dp0"
python ripristina_geca.py
echo      OK

echo  [4/4] Chiudo eventuali proxy attivi su porta 8888...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8888" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      OK

echo.
echo  ================================================
echo   INTERNET RIPRISTINATO - tutto a posto!
echo  ================================================
echo.
echo  Nota: per usare il proxy GECA Intel in futuro,
echo  il proxy Python deve essere GIA AVVIATO prima
echo  di aprire GeCA. Se lo chiudi, chiudi anche GeCA.
echo.
pause
