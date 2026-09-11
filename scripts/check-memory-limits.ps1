# ADVISOR — Verificación de límites de memoria persistente (Windows PowerShell).
# Equivalente a check-memory-limits.sh para proyectos en Windows puro.
#
# Uso:
#   powershell -File .\scripts\check-memory-limits.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\check-memory-limits.ps1

$ErrorActionPreference = "Stop"

$projectRoot = try { (git rev-parse --show-toplevel 2>$null).Trim() } catch { $null }
if (-not $projectRoot) { $projectRoot = (Get-Location).Path }

$projectState = Join-Path $projectRoot "PROJECT_STATE.md"
$summary = Join-Path $projectRoot "SUMMARY.md"

function Write-Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "ℹ️  $msg" -ForegroundColor DarkGray }

$errors = 0

# PROJECT_STATE.md (capa 0: < ~100 líneas)
if (Test-Path $projectState) {
  $lines = (Get-Content $projectState | Measure-Object -Line).Lines
  if ($lines -gt 100) {
    Write-Warn "PROJECT_STATE.md tiene $lines líneas (límite: 100)."
    Write-Info "Ejecuta '/compact-state' en opencode para compactar."
    $errors++
  } else {
    Write-Ok "PROJECT_STATE.md tiene $lines líneas (dentro del límite de 100)."
  }
} else {
  Write-Warn "PROJECT_STATE.md no encontrado."
  $errors++
}

# SUMMARY.md (capa 1: < ~150 líneas)
if (Test-Path $summary) {
  $lines = (Get-Content $summary | Measure-Object -Line).Lines
  if ($lines -gt 150) {
    Write-Warn "SUMMARY.md tiene $lines líneas (límite: 150)."
    Write-Info "Es probable que sea hora de rotar la entrada más antigua a CHANGELOG/"
    Write-Info "Ejecuta '/rotate-memory' en opencode para rotación manual."
    $errors++
  } else {
    Write-Ok "SUMMARY.md tiene $lines líneas (dentro del límite de 150)."
  }
} else {
  Write-Info "SUMMARY.md no existe aún (se creará al registrar el primer progreso)."
}

Write-Host ""
if ($errors -gt 0) {
  Write-Warn "Se detectaron $errors problema(s) de límite de memoria."
  exit 1
} else {
  Write-Ok "Todos los límites de memoria están dentro de los rangos esperados."
  exit 0
}
