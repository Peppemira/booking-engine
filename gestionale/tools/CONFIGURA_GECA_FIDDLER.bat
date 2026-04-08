@echo off
chcp 65001 > nul
echo ============================================
echo  Configura GeCA per usare Fiddler come proxy
echo  (solo GeCA - nessun proxy di sistema)
echo ============================================
echo.
echo PREREQUISITI:
echo  1. Fiddler e' aperto e funzionante
echo  2. In Fiddler: Tools > Options > Connections
echo     annota il numero di porta (di solito 8888)
echo.
set /p FIDDLER_PORT="Porta Fiddler (premi INVIO per 8888): "
if "%FIDDLER_PORT%"=="" set FIDDLER_PORT=8888

echo.
echo Configurazione proxy per GeCA su porta %FIDDLER_PORT%...
python "%~dp0configura_geca_fiddler.py" %FIDDLER_PORT%

echo.
echo Ora:
echo  1. Apri GecaFuture.exe
echo  2. Usa GeCA normalmente (candidati, portale, pratiche)
echo  3. Le chiamate appariranno in Fiddler E nel GECA Intel
echo.
echo Per ripristinare GeCA senza proxy: doppio click su RIPRISTINA_GECA.bat
echo.
pause
