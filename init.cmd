@echo off
REM Consigliere 2.0 (Advisor Harness) — Shim CMD solo por proyecto (sin global)
REM Uso: init.cmd [ruta\proyecto]  o  npx advisor-harness@latest [ruta]
setlocal
set "ARGS="
:loop
if "%~1"=="" goto run
set "ARGS=%ARGS% "%~1""
shift
goto loop
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init.ps1" %ARGS%
