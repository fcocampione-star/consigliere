#Requires -Version 5.1
<#
.SYNOPSIS
  CONSIGLIERE — Harness de agentes + memoria persistente para opencode (Windows PowerShell).
  Genera un harness completo en un directorio de proyecto nuevo. Soporta instalación global.

.DESCRIPTION
  Equivalente Windows de init.sh. Funciona en PowerShell 5.1+ y PowerShell 7+ sin bash.

.EXAMPLE
  .\init.ps1                          # modo interactivo
  .\init.ps1 -InstallGlobal            # instalar globalmente
  .\init.ps1 -UninstallGlobal          # desinstalar
  .\init.ps1 -Version                 # versión
  .\init.ps1 C:\ruta\proyecto         # no-interactivo
#>
param(
  [switch]$InstallGlobal,
  [switch]$UninstallGlobal,
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
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Remaining
)

$VERSION = "1.0.0"
$SCRIPT_PATH = $PSCommandPath
if (-not $SCRIPT_PATH) { $SCRIPT_PATH = $MyInvocation.MyCommand.Path }

# Rutas globales (paridad con init.sh/init.mjs)
$HOME_DIR = $HOME
if (-not $HOME_DIR) { $HOME_DIR = $env:USERPROFILE }
$GLOBAL_BIN = Join-Path $HOME_DIR ".local\bin\consigliere-init.ps1"
$GLOBAL_SHARE = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "consigliere" } else { Join-Path $HOME_DIR ".local\share\consigliere" }
$GLOBAL_TEMPLATES = Join-Path $GLOBAL_SHARE "templates"
$TEMPLATE_DIR = Join-Path (Split-Path $SCRIPT_PATH -Parent) "templates"
# Si se ejecuta desde instalación global
if ($SCRIPT_PATH -eq $GLOBAL_BIN -and (Test-Path $GLOBAL_TEMPLATES)) {
  $TEMPLATE_DIR = $GLOBAL_TEMPLATES
}

function Write-Info($msg) { Write-Host "ℹ️  $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "❌ $msg" -ForegroundColor Red }
function Write-Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor White -BackgroundColor DarkBlue }

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
  Write-Host "  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v$VERSION)" -ForegroundColor DarkGray
}

function Show-Help {
  Write-Host @"
CONSIGLIERE v$VERSION — Harness de agentes + memoria persistente para opencode.

Uso:
  .\init.ps1                          modo interactivo
  .\init.ps1 -InstallGlobal            instalar globalmente
  .\init.ps1 -UninstallGlobal          desinstalar
  .\init.ps1 -Version | -Help
  .\init.ps1 <ruta\proyecto>           crear proyecto

Flags (no-interactivo):
  -Dir <ruta>              directorio destino
  -Name <nombre>           nombre del proyecto
  -StackDb/-StackBackend/-StackFrontend/-StackAuth/-StackValidation/-StackDeploy <v>
  -Autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  -Git <yes|no>            inicializar git
"@
}

function Install-Global {
  Write-Step "Instalando CONSIGLIERE globalmente"
  if (-not (Test-Path $TEMPLATE_DIR)) { Write-Err "No encuentro templates en '$TEMPLATE_DIR'"; exit 1 }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Err "No se detectó git. Instala Git for Windows."; exit 1 }

  New-Item -ItemType Directory -Force -Path (Split-Path $GLOBAL_BIN) | Out-Null
  New-Item -ItemType Directory -Force -Path $GLOBAL_SHARE | Out-Null
  Copy-Item -Path $SCRIPT_PATH -Destination $GLOBAL_BIN -Force
  if (Test-Path $GLOBAL_TEMPLATES) { Remove-Item -Recurse -Force $GLOBAL_TEMPLATES }
  Copy-Item -Path $TEMPLATE_DIR -Destination $GLOBAL_TEMPLATES -Recurse -Force

  if ((Test-Path $GLOBAL_BIN) -and (Test-Path $GLOBAL_TEMPLATES)) {
    Write-Ok "Instalado globalmente."
    Write-Ok "Bin: $GLOBAL_BIN"
    Write-Ok "Templates: $GLOBAL_TEMPLATES"
    $pathEnv = $env:PATH
    $binDir = Split-Path $GLOBAL_BIN
    if ($pathEnv -notlike "*$binDir*") {
      Write-Warn "$binDir no está en PATH en esta sesión."
      Write-Info "Añadiendo a PATH de usuario..."
      try {
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($userPath -notlike "*$binDir*") {
          [Environment]::SetEnvironmentVariable("PATH", "$userPath;$binDir", "User")
          Write-Ok "Añadido a PATH de usuario. Reinicia la terminal."
        }
        $env:PATH += ";$binDir"
      } catch {
        Write-Warn "No se pudo modificar PATH automáticamente. Añade manualmente: $binDir"
      }
    }
    # Preguntar siguiente paso
    $choice = Read-Host "¿Qué quieres hacer ahora? 1) Crear proyecto ahora  2) Ver pasos y salir  [1-2]"
    if ($choice -eq "1") { Invoke-InteractiveCreate } else { Show-NextStepsGlobal }
  } else {
    Write-Err "Falló la copia de los binarios. Revisa permisos."
    exit 1
  }
}

function Show-NextStepsGlobal {
  Write-Host "`n  ▶ Qué hacer ahora (pasos copiables):"
  Write-Host "    1. Verifica: powershell -File `"$GLOBAL_BIN`" -Version"
  Write-Host "    2. Ve a tu proyecto: cd C:\ruta\a\tu-proyecto"
  Write-Host "    3. Ejecuta: powershell -File `"$GLOBAL_BIN`" C:\ruta\proyecto"
  Write-Host "    4. Sigue el asistente: nombre -> stack -> modelos -> autoskills -> git"
  Write-Host "    5. Dentro del proyecto: edita AGENTS.md"
  Write-Host "    6. Arranca: opencode -> /routine `"configurar base del proyecto`""
}

function Uninstall-Global {
  Write-Step "Desinstalando versión global"
  $removed = $false
  if (Test-Path $GLOBAL_BIN) { Remove-Item -Force $GLOBAL_BIN; Write-Ok "Eliminado: $GLOBAL_BIN"; $removed = $true }
  if (Test-Path $GLOBAL_SHARE) { Remove-Item -Recurse -Force $GLOBAL_SHARE; Write-Ok "Eliminado: $GLOBAL_SHARE"; $removed = $true }
  if (-not $removed) { Write-Info "No había instalación global." }
}

function Render-File($src, $dst, $vars) {
  $content = Get-Content -Raw -Path $src -Encoding utf8
  foreach ($k in $vars.Keys) {
    $content = $content.Replace("{{$k}}", $vars[$k])
  }
  $dir = Split-Path $dst -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -Path $dst -Value $content -Encoding utf8 -NoNewline
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
    & git -C $repo -c user.name="CONSIGLIERE" -c user.email="consigliere@local" commit -q -m "chore: scaffold harness CONSIGLIERE"
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
  Write-Host "`nPróximos pasos:"
  Write-Host "  1. cd $targetDir"
  Write-Host "  2. Edita AGENTS.md"
  Write-Host "  3. Edita .opencode/skills/_project-docs/SKILL.md"
  Write-Host "  4. Arranca opencode -> /routine `"configurar base del proyecto`""
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
  Write-Step "Nuevo proyecto — CONSIGLIERE"
  $targetDir = Read-Host "  📁 Ruta del directorio del proyecto"
  if (-not $targetDir) { Write-Err "Ruta vacía."; exit 1 }
  $targetDir = $targetDir.Replace("~", $HOME_DIR)
  try { $targetDir = (Resolve-Path $targetDir -ErrorAction Stop).Path } catch { $targetDir = [System.IO.Path]::GetFullPath($targetDir) }
  # Si es ruta relativa sin existir, resolver contra cwd
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
  Write-Info "Modelos por subagente (opcional — déjalo vacío para heredar)."
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
  Write-Host "  🤖 Autoskills:"
  Write-Host "  1) En el proyecto (npx autoskills)   ← Recomendado"
  Write-Host "  2) Global (npm i -g autoskills)"
  Write-Host "  3) Saltar"
  $AUTO_CHOICE = Read-Host "  > [1-3]"
  if (-not $AUTO_CHOICE) { $AUTO_CHOICE = "1" }
  $gitChoice = Read-Host "  📦 Inicializar git + commit inicial? [S/n]"
  $DO_GIT = $true; if ($gitChoice -match '^[Nn]$') { $DO_GIT = $false }

  Write-Host "`n  Resumen:"
  Write-Host "    Proyecto : $projectName"
  Write-Host "    Destino  : $targetDir"
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
  Write-Ok "Harness generado (agents, commands, skills, memoria)"

  if ($DO_GIT) { Git-InitAndCommit $TargetDir } else { Write-Warn "Git no inicializado." }
  Handle-Autoskills $AUTO_CHOICE $TargetDir
  Show-Finish $ProjectName $TargetDir
}

# ---- Dispatch ----
if ($Version) { Write-Host "CONSIGLIERE v$VERSION"; exit 0 }
if ($Help) { Show-Help; exit 0 }
if ($InstallGlobal) { Install-Global; exit 0 }
if ($UninstallGlobal) {
  $c = Read-Host "  ¿Seguro? Esto borrará la instalación global. [s/N]"
  if ($c -notmatch '^[Ss]$') { Write-Warn "Cancelado."; exit 0 }
  Uninstall-Global; exit 0
}

# Si se pasó ruta posicional en $Remaining (ej: .\init.ps1 C:\proj)
if ($Remaining -and -not $Dir) { $Dir = $Remaining[0] }
if ($Name) { $Dir = $Dir } # placeholder para evitar warning

if ($Dir -or $Name -or $StackDb -or $StackBackend) {
  # Modo no-interactivo
  if (-not $Dir) { Write-Err "Falta el directorio destino. Usa -Dir <ruta>"; Show-Help; exit 1 }
  $targetDir = $Dir.Replace("~", $HOME_DIR)
  if (-not [System.IO.Path]::IsPathRooted($targetDir)) { $targetDir = Join-Path (Get-Location).Path $targetDir }
  $projectName = if ($Name) { $Name } else { Split-Path $targetDir -Leaf }
  $lang = "typescript"; if ($StackBackend -like "*python*") { $lang = "python" } elseif ($StackBackend -like "*go*") { $lang = "go" }
  $doGit = $Git -ne "no"
  Write-Step "Generando proyecto '$projectName'"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $vars = @{
    PROJECT_NAME = $projectName; STACK_DB = $StackDb; STACK_BACKEND = $StackBackend; STACK_FRONTEND = $StackFrontend
    STACK_AUTH = $StackAuth; STACK_VALIDATION = $StackValidation; STACK_DEPLOY = $StackDeploy; DEV_COMMANDS = ""
    MODEL_ORCHESTRATOR = ""; MODEL_PLANNER = ""; MODEL_BUILDER = ""; MODEL_VERIFIER = ""; MODEL_CRITIC = ""; MODEL_SUMMARIZER = ""; MODEL_EXPLORE = ""; LANG_BACKEND = $lang
  }
  Render-Tree $TEMPLATE_DIR $targetDir $vars
  New-Item -ItemType Directory -Force -Path (Join-Path $targetDir "CHANGELOG") | Out-Null
  Write-Ok "Harness generado"
  if ($doGit) { Git-InitAndCommit $targetDir }
  if ($Autoskills -ne "3" -and $Autoskills -ne "no") { Handle-Autoskills $Autoskills $targetDir }
  Show-Finish $projectName $targetDir
  exit 0
}

# Sin args → menú
if (-not $Dir -and -not $InstallGlobal -and -not $UninstallGlobal -and -not $Version -and -not $Help) {
  Show-Banner
  Write-Host ""
  if ((Test-Path $GLOBAL_BIN) -and (Test-Path $GLOBAL_TEMPLATES)) { Write-Ok "CONSIGLIERE ya está instalado globalmente." } else { Write-Info "CONSIGLIERE no está instalado globalmente todavía." }
  Write-Host ""
  Write-Host "  ¿Qué quieres hacer?"
  Write-Host "  1) Instalar/actualizar globalmente (solo la primera vez)"
  Write-Host "  2) Crear un nuevo proyecto (harness) usando esta copia local"
  Write-Host "  3) Desinstalar la versión global"
  Write-Host "  4) Salir"
  $choice = Read-Host "  > Elección [1-4]"
  switch ($choice) {
    "1" { Install-Global }
    "2" { Invoke-InteractiveCreate }
    "3" { $c = Read-Host "  ¿Seguro? Esto borrará la instalación global. [s/N]"; if ($c -match '^[Ss]$') { Uninstall-Global } }
    "4" { exit 0 }
    default { Write-Warn "Opción inválida." }
  }
}
