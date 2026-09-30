@echo off
REM Consigliere 2.0 (Advisor Harness) — Shim CMD solo por proyecto (sin global)
REM Uso: init.cmd [ruta\proyecto]  o  npx advisor-harness@latest [ruta]
REM Delega en init.ps1 -> init.mjs reenviando %* tal cual (sin reconstruir ARGS).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init.ps1" %*
exit /b %ERRORLEVEL%
