@echo off
REM CONSIGLIERE — Shim CMD para Windows
REM Delega a PowerShell. Uso: init.cmd [args] o consigliere-init
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init.ps1" %*
