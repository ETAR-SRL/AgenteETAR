@echo off
setlocal DisableDelayedExpansion
if /I "%~1"=="--check" goto comprobar
if /I "%~1"=="--preview" goto comprobar
if /I "%~1"=="--offline" goto offline
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-app-windows.ps1" -PackagePath "%~1"
goto resultado
:comprobar
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-app-windows.ps1" -Check -PackagePath "%~2"
goto resultado
:offline
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-app-windows.ps1" -Offline -PackagePath "%~2"
:resultado
set "resultado=%errorlevel%"
if not "%resultado%"=="0" echo La actualizacion no se completo. Revisar el resultado y el respaldo indicados.
if "%~1"=="" pause
exit /b %resultado%
