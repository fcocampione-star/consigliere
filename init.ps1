#Requires -Version 5.1
<#
.SYNOPSIS
  Consigliere 2.0 (Advisor Harness) — shim PowerShell: delega todo en init.mjs (única implementación).
.DESCRIPTION
  Sin instalación global. Uso: npx advisor-harness@latest <ruta> o powershell -File init.ps1 <ruta>
.NOTES
  El guard de compatibilidad no se pierde: #Requires -Version 5.1 (arriba) aborta al parsear en
  Windows PowerShell <5.1, por eso ya no hace falta el chequeo $PSVersionTable en runtime.
#>

# Const de versión: solo para el chequeo de fuente única .opencode/scripts/version-check.mjs.
$HARNESS_VERSION = "2.0.0"

$init = Join-Path $PSScriptRoot 'init.mjs'

$nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCmd) {
  [Console]::Error.WriteLine("❌ Node no encontrado. Alternativa: npx advisor-harness@latest <ruta/proyecto>")
  exit 3
}

# Call operator + matriz de argumentos: los tokens con guion no se interpretan como parámetros.
& $nodeCmd.Path $init @args
exit $LASTEXITCODE
