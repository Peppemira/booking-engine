@echo off
chcp 65001 > nul
echo Creazione collegamento sul Desktop...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\GECA Intel.lnk');$s.TargetPath='C:\Users\bluef\booking-engine\gestionale\tools\GECA_INTEL_LAUNCHER.hta';$s.IconLocation='C:\Windows\System32\mshta.exe';$s.Description='GECA Intel Pannello di Controllo';$s.Save()"

echo.
echo Collegamento creato sul Desktop: "GECA Intel"
echo Fai doppio click sull icona per aprire il pannello.
echo.
pause
