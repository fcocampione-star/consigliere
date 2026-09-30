# ADVISOR — Verificación de límites de memoria persistente (Windows PowerShell).
# Equivalente a check-memory-limits.sh para proyectos en Windows puro.
#
# NOTA: el conteo usa `Measure-Object -Line`, que EXCLUYE líneas vacías, así que
# subcuenta frente al `wc -l` del hermano bash (47 vs 70 líneas en este repo).
# Los umbrales (100/150/15) y los exit codes son los mismos; la rotación canónica
# la decide el motor `memory-rotate.mjs` (`contentLines` entre ADVISOR:ENTRIES).
#
# Uso:
#   powershell -File .\scripts\check-memory-limits.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\check-memory-limits.ps1

$ErrorActionPreference = "Stop"

$projectRoot = try { (git rev-parse --show-toplevel 2>$null).Trim() } catch { $null }
if (-not $projectRoot) { $projectRoot = (Get-Location).Path }

$projectState = Join-Path $projectRoot "PROJECT_STATE.md"
$summary = Join-Path $projectRoot "SUMMARY.md"
$manifest = Join-Path $projectRoot ".advisor/memory-manifest.json"

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

# memory-manifest.json (derivado trackeable: <15 líneas)
if (Test-Path $manifest) {
  $lines = (Get-Content $manifest | Measure-Object -Line).Lines
  if ($lines -ge 15) {
    Write-Warn "memory-manifest.json tiene $lines líneas (límite: <15)."
    Write-Info "Regenera con 'node .opencode/scripts/memory-sync.mjs buildManifest'."
    $errors++
  } else {
    Write-Ok "memory-manifest.json tiene $lines líneas (dentro del límite de 15)."
  }
} else {
  Write-Info "memory-manifest.json no existe aún (se genera con 'node .opencode/scripts/memory-sync.mjs buildManifest')."
}

Write-Host ""
if ($errors -gt 0) {
  Write-Warn "Se detectaron $errors problema(s) de límite de memoria."
  exit 1
} else {
  Write-Ok "Todos los límites de memoria están dentro de los rangos esperados."
  exit 0
}
