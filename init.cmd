@echo off
REM CONSIGLIERE 2.0 — Shim CMD solo por proyecto (sin global)
REM Uso: init.cmd [ruta\proyecto]  o  npx consigliere-harness@latest [ruta]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init.ps1" %*
