@echo off
setlocal DisableDelayedExpansion
if "%~1"=="" goto instalar
if /I "%~1"=="--preview" goto preview
if /I "%~1"=="/preview" goto preview
if /I "%~1"=="--check" goto preview
if /I "%~1"=="--dry-run" goto preview
if /I "%~1"=="--install-only" goto preparar
echo Uso: Instalar-servicio.bat [--preview ^| --install-only]
exit /b 2
:instalar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-servicio-windows.ps1"
goto resultado
:preview
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-servicio-windows.ps1" -Check
goto resultado
:preparar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-servicio-windows.ps1" -InstallOnly
:resultado
set "resultado=%errorlevel%"
if not "%resultado%"=="0" echo No se completo la comprobacion o instalacion. Revisar el mensaje anterior.
if "%~1"=="" pause
exit /b %resultado%
