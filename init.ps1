#Requires -Version 5.1
<#
.SYNOPSIS
  CONSIGLIERE 2.0 — Harness de agentes + memoria persistente para opencode (solo por proyecto).
.DESCRIPTION
  Sin instalación global. Uso: npx consigliere@latest <ruta> o powershell -File init.ps1 <ruta>
.EXAMPLE
  .\init.ps1                          # modo interactivo
  .\init.ps1 -Version                 # versión
  .\init.ps1 C:\ruta\proyecto         # no-interactivo
#>
param(
  [switch]$Version,
  [switch]$Help,
  [string]$Dir,
  [string]$Name,
  [string]$StackDb,
  [string]$StackBackend,
  [string]$StackFrontend,
  [string]$StackAuth,
  [string]$StackValidation,
  [string]$StackDeploy,
  [string]$Autoskills = "1",
  [string]$Git = "yes",
  [switch]$Upgrade,
  [switch]$DryRun,
  [switch]$Force,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Remaining
)

$VERSION = "2.0.0"
$SCRIPT_PATH = $PSCommandPath
if (-not $SCRIPT_PATH) { $SCRIPT_PATH = $MyInvocation.MyCommand.Path }
$HOME_DIR = $HOME
if (-not $HOME_DIR) { $HOME_DIR = $env:USERPROFILE }
$TEMPLATE_DIR = Join-Path (Split-Path $SCRIPT_PATH -Parent) "templates"
$SCRIPT_NAME = Split-Path $SCRIPT_PATH -Leaf

$BACKUP_ITEMS = @('.opencode','AGENTS.md','PROJECT_STATE.md','SUMMARY.md','CHANGELOG','.consigliere','opencode.json','.gitignore','skills-lock.json','scripts')
$PRESERVED = @('PROJECT_STATE.md','SUMMARY.md','opencode.json','AGENTS.md','.gitignore')

function Write-Info($msg) { Write-Host "ℹ️  $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "❌ $msg" -ForegroundColor Red }
function Write-Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor White -BackgroundColor DarkBlue }

if ($PSVersionTable.PSVersion.Major -lt 5 -or ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -lt 1)) {
  Write-Err "PowerShell >=5.1 requerido. Actual: $($PSVersionTable.PSVersion)"
  exit 1
}

function Show-Banner {
  Write-Host @"

                                             ░██           ░██ ░██
                                                           ░██
  ░███████   ░███████  ░████████   ░███████  ░██ ░████████ ░██ ░██ ░███████  ░██░████  ░███████
 ░██    ░██ ░██    ░██ ░██    ░██ ░██        ░██░██    ░██ ░██ ░██░██    ░██ ░███     ░██    ░██
 ░██        ░██    ░██ ░██    ░██  ░███████  ░██░██    ░██ ░██ ░██░█████████ ░██      ░█████████
 ░██    ░██ ░██    ░██ ░██    ░██        ░██ ░██░██   ░███ ░██ ░██░██        ░██      ░██
  ░███████   ░███████  ░██    ░██  ░███████  ░██ ░█████░██ ░██ ░██ ░███████  ░██       ░███████
                                                       ░██
                                                 ░███████

"@ -ForegroundColor Cyan
  Write-Host "  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v$VERSION · solo por proyecto)" -ForegroundColor DarkGray
}

function Show-Help {
  Write-Host @"
CONSIGLIERE v$VERSION — Harness de agentes + memoria persistente para opencode (solo por proyecto).

Uso:
  .\init.ps1                          modo interactivo
  .\init.ps1 -Version | -Help
  .\init.ps1 <ruta\proyecto>           crear proyecto
  .\init.ps1 <ruta\proyecto> -Upgrade  actualizar harness (backup keep 5, preserva memoria/config; no requiere -Force)
  .\init.ps1 <ruta\proyecto> -DryRun   simulación sin escribir
  .\init.ps1 <ruta\proyecto> -Force    sobrescribir destino no vacío (solo sin -Upgrade)

Flags:
  -Dir <ruta>              directorio destino
  -Name <nombre>           nombre del proyecto
  -StackDb/-StackBackend/-StackFrontend/-StackAuth/-StackValidation/-StackDeploy <v>
  -Autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  -Git <yes|no>            inicializar git
  -Upgrade                 actualizar harness (backup keep 5, preserva memoria/config; no requiere -Force)
  -DryRun                  no escribir, solo loguear
  -Force                   sobrescribir destino no vacío (solo sin -Upgrade)

Instalación: solo por proyecto, sin binario global.
  npx consigliere@latest C:\ruta\proyecto
  powershell -File init.ps1 C:\ruta\proyecto
"@
}

function Render-File($src, $dst, $vars) {
  $content = Get-Content -Raw -Path $src -Encoding utf8
  foreach ($k in $vars.Keys) {
    $content = $content.Replace("{{$k}}", $vars[$k])
  }
  $dir = Split-Path $dst -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBOM = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($dst, $content, $utf8NoBOM)
}

function Render-Tree($src, $dst, $vars) {
  foreach ($item in Get-ChildItem -Path $src -Force) {
    $out = Join-Path $dst $item.Name
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $out | Out-Null
      Render-Tree $item.FullName $out $vars
    } else {
      $isTemplate = $item.Name -match '\.(md|json|mjs|sh|ps1)$'
      if ($isTemplate) { Render-File $item.FullName $out $vars }
      else { Copy-Item -Path $item.FullName -Destination $out -Force }
    }
  }
}

function Install-GitHook($repo) {
  $src = Join-Path $TEMPLATE_DIR ".opencode\hooks\post-commit-memory-rotate.sh"
  $dst = Join-Path $repo ".git\hooks\post-commit"
  if (Test-Path $src) { Copy-Item -Path $src -Destination $dst -Force }
}

function Git-InitAndCommit($repo) {
  if (-not (Test-Path (Join-Path $repo ".git"))) {
    & git -C $repo init -q
    Install-GitHook $repo
    & git -C $repo add .
    & git -C $repo -c user.name="CONSIGLIERE" -c user.email="consigliere@local" commit -q -m "chore: scaffold harness CONSIGLIERE 2.0"
    Write-Ok "Git + hook post-commit + commit inicial"
  } else {
    Install-GitHook $repo
    Write-Warn "Ya existía repo git; solo se instaló el hook."
  }
}

function Handle-Autoskills($mode, $dir) {
  switch ($mode) {
    "2" {
      Write-Step "Instalando autoskills global"
      & npm i -g autoskills
      if ($LASTEXITCODE -eq 0) { Write-Ok "autoskills global instalado" } else { Write-Warn "npm i -g autoskills falló" }
    }
    "3" { Write-Info "Autoskills omitido. Instálalas luego con: cd `"$dir`" && npx autoskills" }
    default {
      Write-Step "Instalando autoskills en el proyecto"
      if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warn "Node no encontrado. Instala node y corre: npx autoskills"; return }
      Push-Location $dir
      & npx --yes autoskills
      if ($LASTEXITCODE -eq 0) { Write-Ok "autoskills ejecutado" } else { Write-Warn "autoskills no corrió (¿falta package.json?)" }
      Pop-Location
    }
  }
}

function Show-Finish($projectName, $targetDir) {
  Write-Host "`n═══════════════════════════════════════════════════════════════════" -ForegroundColor Green
  Write-Host "🎉  ¡Proyecto '$projectName' listo en $targetDir!" -ForegroundColor White
  Write-Host "  Instalación 100% por proyecto — sin binario global. Actualiza: npx consigliere@latest $targetDir --upgrade"
  Write-Host "`nComandos: /discover, /routine, /doctor, /record, /review, /rotate-memory, /compact-state"
}

function Prompt-StackItem($label, $opts) {
  Write-Host "  $label`:" -ForegroundColor White
  for ($i = 0; $i -lt $opts.Count; $i++) { Write-Host "    $($i+1)) $($opts[$i])" }
  Write-Host "    $($opts.Count+1)) Otro... (escribir libre)"
  Write-Host "    $($opts.Count+2)) Saltar (dejar vacío)"
  $val = Read-Host "  > Elegir [1-$($opts.Count)] o escribir"
  if ($val -match '^\d+$') {
    $n = [int]$val
    if ($n -ge 1 -and $n -le $opts.Count) { return $opts[$n - 1] }
    return ""
  }
  return $val
}

function Invoke-InteractiveCreate {
  Show-Banner
  Write-Step "Nuevo proyecto — CONSIGLIERE 2.0 (solo por proyecto)"
  $targetDir = Read-Host "  📁 Ruta del directorio del proyecto"
  if (-not $targetDir) { Write-Err "Ruta vacía."; exit 1 }
  $targetDir = $targetDir.Replace("~", $HOME_DIR)
  try { $targetDir = (Resolve-Path $targetDir -ErrorAction Stop).Path } catch { $targetDir = [System.IO.Path]::GetFullPath($targetDir) }
  if (-not [System.IO.Path]::IsPathRooted($targetDir)) { $targetDir = Join-Path (Get-Location).Path $targetDir }
  $parent = Split-Path $targetDir -Parent
  if (-not (Test-Path $parent)) { Write-Warn "El directorio padre '$parent' no existe. Lo crearé." }
  if ((Test-Path $targetDir) -and ((Get-ChildItem -Path $targetDir -Force | Measure-Object).Count -gt 0)) {
    Write-Warn "El directorio '$targetDir' existe y no está vacío."
    $c = Read-Host "  ¿Continuar y añadir el harness de todos modos? [s/N]"
    if ($c -notmatch '^[Ss]$') { Write-Info "Cancelado."; exit 0 }
  }
  $defaultName = Split-Path $targetDir -Leaf
  $projectName = Read-Host "  Nombre del proyecto [$defaultName]"
  if (-not $projectName) { $projectName = $defaultName }
  Write-Host ""
  Write-Info "Stack (opcional — pre-rellena AGENTS.md). Enter = saltar."
  $STACK_DB = Prompt-StackItem "Base de datos" @("postgresql","sqlite","mysql","mariadb","mongodb")
  $STACK_BACKEND = Prompt-StackItem "Backend" @("node/express","node/fastify","nextjs","python/fastapi","python/django","go")
  $STACK_FRONTEND = Prompt-StackItem "Frontend" @("react/vite","nextjs","astro","sveltekit","vue/vite")
  $STACK_AUTH = Prompt-StackItem "Autenticación" @("jwt","session","oauth2","cognito","auth0")
  $STACK_VALIDATION = Prompt-StackItem "Validación" @("zod","valibot","joi","yup")
  $STACK_DEPLOY = Prompt-StackItem "Deploy" @("docker","vercel","fly","railway","aws")
  Write-Host ""
  Write-Info "Modelos por subagente (opcional — cheap=verifier/summarizer/explore, strong=builder/planner/critic)."
  $MODEL_ORCHESTRATOR = Read-Host "  Modelo [orchestrator] (Enter = heredar)"
  $MODEL_PLANNER = Read-Host "  Modelo [planner] (Enter = heredar)"
  $MODEL_BUILDER = Read-Host "  Modelo [builder] (Enter = heredar)"
  $MODEL_CRITIC = Read-Host "  Modelo [critic] (Enter = heredar)"
  $MODEL_VERIFIER = Read-Host "  Modelo [verifier] (Enter = heredar)"
  $MODEL_SUMMARIZER = Read-Host "  Modelo [summarizer] (Enter = heredar)"
  $MODEL_EXPLORE = Read-Host "  Modelo [explore] (Enter = heredar)"
  $LANG_BACKEND = "typescript"
  if ($STACK_BACKEND -like "*python*") { $LANG_BACKEND = "python" }
  elseif ($STACK_BACKEND -like "*go*") { $LANG_BACKEND = "go" }
  Write-Host ""
  Write-Step "Opciones finales"
  Write-Host "  🤖 Autoskills: 1) En el proyecto (npx autoskills)   2) Global (npm i -g autoskills)  3) Saltar"
  $AUTO_CHOICE = Read-Host "  > [1-3]"
  if (-not $AUTO_CHOICE) { $AUTO_CHOICE = "1" }
  $gitChoice = Read-Host "  📦 Inicializar git + commit inicial? [S/n]"
  $DO_GIT = $true; if ($gitChoice -match '^[Nn]$') { $DO_GIT = $false }
  Write-Host "`n  Resumen: Proyecto $projectName Destino $targetDir"
  $go = Read-Host "  ¿Continuar? [S/n]"
  if ($go -match '^[Nn]$') { Write-Info "Cancelado."; exit 0 }
  Invoke-CreateProject -ProjectName $projectName -TargetDir $targetDir -STACK_DB $STACK_DB -STACK_BACKEND $STACK_BACKEND -STACK_FRONTEND $STACK_FRONTEND -STACK_AUTH $STACK_AUTH -STACK_VALIDATION $STACK_VALIDATION -STACK_DEPLOY $STACK_DEPLOY -LANG_BACKEND $LANG_BACKEND -MODEL_ORCHESTRATOR $MODEL_ORCHESTRATOR -MODEL_PLANNER $MODEL_PLANNER -MODEL_BUILDER $MODEL_BUILDER -MODEL_CRITIC $MODEL_CRITIC -MODEL_VERIFIER $MODEL_VERIFIER -MODEL_SUMMARIZER $MODEL_SUMMARIZER -MODEL_EXPLORE $MODEL_EXPLORE -AUTO_CHOICE $AUTO_CHOICE -DO_GIT $DO_GIT
}

function Invoke-CreateProject {
  param($ProjectName, $TargetDir, $STACK_DB, $STACK_BACKEND, $STACK_FRONTEND, $STACK_AUTH, $STACK_VALIDATION, $STACK_DEPLOY, $LANG_BACKEND, $MODEL_ORCHESTRATOR, $MODEL_PLANNER, $MODEL_BUILDER, $MODEL_CRITIC, $MODEL_VERIFIER, $MODEL_SUMMARIZER, $MODEL_EXPLORE, $AUTO_CHOICE, $DO_GIT)
  Write-Step "Generando proyecto '$ProjectName'"
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  Write-Ok "Estructura base creada"
  $vars = @{
    PROJECT_NAME = $ProjectName; STACK_DB = $STACK_DB; STACK_BACKEND = $STACK_BACKEND; STACK_FRONTEND = $STACK_FRONTEND
    STACK_AUTH = $STACK_AUTH; STACK_VALIDATION = $STACK_VALIDATION; STACK_DEPLOY = $STACK_DEPLOY; DEV_COMMANDS = ""
    MODEL_ORCHESTRATOR = $MODEL_ORCHESTRATOR; MODEL_PLANNER = $MODEL_PLANNER; MODEL_BUILDER = $MODEL_BUILDER
    MODEL_VERIFIER = $MODEL_VERIFIER; MODEL_CRITIC = $MODEL_CRITIC; MODEL_SUMMARIZER = $MODEL_SUMMARIZER; MODEL_EXPLORE = $MODEL_EXPLORE; LANG_BACKEND = $LANG_BACKEND
  }
  Render-Tree $TEMPLATE_DIR $TargetDir $vars
  New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir "CHANGELOG") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir ".consigliere\backups") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir ".consigliere\chunks") | Out-Null
  Write-Ok "Harness generado (agents, commands, skills, memoria, scripts)"
  if ($DO_GIT) { Git-InitAndCommit $TargetDir } else { Write-Warn "Git no inicializado." }
  Handle-Autoskills $AUTO_CHOICE $TargetDir
  Show-Finish $ProjectName $TargetDir
}

# ---- Dispatch ----
if ($Version) { Write-Host "CONSIGLIERE v$VERSION"; exit 0 }
if ($Help) { Show-Help; exit 0 }

# Parse Remaining: support --dry-run/--force/--upgrade and --dir style for parity
if ($Remaining) {
  for ($ri = 0; $ri -lt $Remaining.Count; $ri++) {
    $r = $Remaining[$ri]
    switch ($r) {
      "--dry-run" { $DryRun = $true; continue }
      "-DryRun" { $DryRun = $true; continue }
      "--force" { $Force = $true; continue }
      "-Force" { $Force = $true; continue }
      "--upgrade" { $Upgrade = $true; continue }
      "--dir" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --dir requiere un valor."; exit 1 }; $Dir = $Remaining[++$ri]; continue }
      "--name" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --name requiere un valor."; exit 1 }; $Name = $Remaining[++$ri]; continue }
      "--stack-db" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --stack-db requiere un valor."; exit 1 }; $StackDb = $Remaining[++$ri]; continue }
      "--stack-backend" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --stack-backend requiere un valor."; exit 1 }; $StackBackend = $Remaining[++$ri]; continue }
      "--stack-frontend" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --stack-frontend requiere un valor."; exit 1 }; $StackFrontend = $Remaining[++$ri]; continue }
      "--stack-auth" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --stack-auth requiere un valor."; exit 1 }; $StackAuth = $Remaining[++$ri]; continue }
      "--stack-validation" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --stack-validation requiere un valor."; exit 1 }; $StackValidation = $Remaining[++$ri]; continue }
      "--stack-deploy" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --stack-deploy requiere un valor."; exit 1 }; $StackDeploy = $Remaining[++$ri]; continue }
      "--autoskills" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --autoskills requiere un valor."; exit 1 }; $Autoskills = $Remaining[++$ri]; continue }
      "--git" { if ($ri+1 -ge $Remaining.Count -or $Remaining[$ri+1].StartsWith('-')) { Write-Err "Flag --git requiere un valor."; exit 1 }; $Git = $Remaining[++$ri]; continue }
      default {
        if ($r.StartsWith('-') -and $r -notin @('--help','-h','--version','-v')) {
          if ($r -match '^(-Dir|-Name|-StackDb|-StackBackend|-StackFrontend|-StackAuth|-StackValidation|-StackDeploy|-Autoskills|-Git)$') {
            Write-Err "Flag $r requiere un valor."
            exit 1
          }
          if ($r.StartsWith('--')) { Write-Host "⚠️  Flag desconocido: $r" -ForegroundColor Yellow }
        }
        if (-not $Dir -and -not $r.StartsWith('-')) { $Dir = $r }
      }
    }
  }
}

# Validate named params not empty/flag-like
if ($PSBoundParameters.ContainsKey('Dir') -and $Dir) { if ($Dir.StartsWith('-')) { Write-Err "Flag -Dir requiere un valor."; exit 1 } }
if ($PSBoundParameters.ContainsKey('Name') -and $Name) { if ($Name.StartsWith('-')) { Write-Err "Flag -Name requiere un valor."; exit 1 } }
if ($PSBoundParameters.ContainsKey('StackDb') -and $StackDb -and $StackDb.StartsWith('-')) { Write-Err "Flag -StackDb requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('StackBackend') -and $StackBackend -and $StackBackend.StartsWith('-')) { Write-Err "Flag -StackBackend requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('StackFrontend') -and $StackFrontend -and $StackFrontend.StartsWith('-')) { Write-Err "Flag -StackFrontend requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('StackAuth') -and $StackAuth -and $StackAuth.StartsWith('-')) { Write-Err "Flag -StackAuth requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('StackValidation') -and $StackValidation -and $StackValidation.StartsWith('-')) { Write-Err "Flag -StackValidation requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('StackDeploy') -and $StackDeploy -and $StackDeploy.StartsWith('-')) { Write-Err "Flag -StackDeploy requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('Autoskills') -and $Autoskills -and $Autoskills.StartsWith('-')) { Write-Err "Flag -Autoskills requiere un valor."; exit 1 }
if ($PSBoundParameters.ContainsKey('Git') -and $Git -and $Git.StartsWith('-')) { Write-Err "Flag -Git requiere un valor."; exit 1 }

if ($Dir -or $Name -or $StackDb -or $StackBackend) {
  if (-not $Dir) { Write-Err "Falta el directorio destino. Usa -Dir <ruta>"; Show-Help; exit 1 }
  $targetDir = $Dir.Replace("~", $HOME_DIR)
  if (-not [System.IO.Path]::IsPathRooted($targetDir)) { $targetDir = Join-Path (Get-Location).Path $targetDir }
  $projectName = if ($Name) { $Name } else { Split-Path $targetDir -Leaf }
  $lang = "typescript"; if ($StackBackend -like "*python*") { $lang = "python" } elseif ($StackBackend -like "*go*") { $lang = "go" }
  $doGit = $Git -ne "no"

  $hasHarness = (Test-Path (Join-Path $targetDir ".opencode")) -or (Test-Path (Join-Path $targetDir "AGENTS.md"))
  if ((Test-Path $targetDir) -and ((Get-ChildItem -Path $targetDir -Force | Measure-Object).Count -gt 0) -and -not $Force -and -not $DryRun) {
    if ($Upgrade -and $hasHarness) {
      # eximido: harness previo presente → backup + render
    } elseif ($Upgrade) {
      Write-Err "El directorio '$targetDir' no es un proyecto consigliere/harness (sin .opencode/ ni AGENTS.md). -Upgrade requiere un harness previo; usa -Force solo si quieres sobrescribir."
      exit 1
    } else {
      Write-Err "El directorio '$targetDir' existe y no está vacío. Usa -Force para sobrescribir, -DryRun para simular, o -Upgrade para actualizar un harness existente."
      exit 1
    }
  }

  $items = @($BACKUP_ITEMS | Where-Object { Test-Path (Join-Path $targetDir $_) })
  $bf = ""
  if ($Upgrade) {
    if ($items.Count -eq 0) {
      Write-Info "Sin harness previo que respaldar (directorio vacío/inexistente)"
    } elseif ($DryRun) {
      Write-Host "ℹ️  [dry-run] backup -> .consigliere/backups/harness-<ts>.tgz (keep 5): $($items -join ', ')" -ForegroundColor Cyan
      $preview = @($PRESERVED | Where-Object { $items -contains $_ })
      if ($preview.Count -gt 0) { Write-Host "ℹ️  [dry-run] restore -> $($preview -join ', ')" -ForegroundColor Cyan }
    } else {
      Write-Step "Actualizando harness en '$projectName' (backup keep 5)"
      $backupDir = Join-Path $targetDir ".consigliere\backups"
      New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
      $ts = Get-Date -Format "yyyyMMddTHHmmssZ"
      $bf = Join-Path $backupDir "harness-$ts.tgz"
      try {
        & tar -czf $bf -C $targetDir --exclude=.consigliere/backups --exclude=.memory-lock @items 2>$null
      } catch {
        $global:LASTEXITCODE = 1
      }
      if ($LASTEXITCODE -ne 0) {
        Write-Err "Backup falló: $bf"
        exit 1
      }
      Write-Ok "Backup: $bf ($($items.Count) ítems)"
      Get-ChildItem -Path $backupDir -Filter "harness-*.tgz" | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Force -ErrorAction SilentlyContinue
    }
  }

  if ($DryRun) {
    Write-Host "ℹ️  [dry-run] would render $TEMPLATE_DIR -> $targetDir (project: $projectName)" -ForegroundColor Cyan
    Write-Host "ℹ️  [dry-run] no se escribió nada en disco" -ForegroundColor Cyan
    Show-Finish $projectName $targetDir
    exit 0
  }

  Write-Step "Generando proyecto '$projectName'"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $vars = @{
    PROJECT_NAME = $projectName; STACK_DB = $StackDb; STACK_BACKEND = $StackBackend; STACK_FRONTEND = $StackFrontend
    STACK_AUTH = $StackAuth; STACK_VALIDATION = $StackValidation; STACK_DEPLOY = $StackDeploy; DEV_COMMANDS = ""
    MODEL_ORCHESTRATOR = ""; MODEL_PLANNER = ""; MODEL_BUILDER = ""; MODEL_VERIFIER = ""; MODEL_CRITIC = ""; MODEL_SUMMARIZER = ""; MODEL_EXPLORE = ""; LANG_BACKEND = $lang
  }
  Render-Tree $TEMPLATE_DIR $targetDir $vars
  New-Item -ItemType Directory -Force -Path (Join-Path $targetDir "CHANGELOG") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $targetDir ".consigliere\backups") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $targetDir ".consigliere\chunks") | Out-Null
  if ($items.Count -gt 0 -and $bf) {
    $restored = @($PRESERVED | Where-Object { $items -contains $_ })
    if ($restored.Count -gt 0) {
      $rc = 0
      try {
        & tar -xzf $bf -C $targetDir @restored 2>$null
        $rc = $LASTEXITCODE
      } catch {
        $rc = 1
      }
      if ($rc -eq 0) { Write-Ok "Memoria/config preservadas: $($restored -join ', ')" }
      else { Write-Warn "Restauración de memoria/config falló (backup en $bf)" }
    }
  }
  Write-Ok "Harness ${projectName} generado"
  if ($doGit) { Git-InitAndCommit $targetDir }
  if ($Autoskills -ne "3" -and $Autoskills -ne "no") { Handle-Autoskills $Autoskills $targetDir }
  Show-Finish $projectName $targetDir
  exit 0
}

# Sin args → interactivo
Show-Banner
Write-Host ""
Write-Host "  ¿Qué quieres hacer? 1) Crear nuevo proyecto (harness)  2) Salir"
$choice = Read-Host "  > Elección [1-2]"
switch ($choice) {
  "1" { Invoke-InteractiveCreate }
  "2" { exit 0 }
  default { Write-Warn "Opción inválida." }
}
