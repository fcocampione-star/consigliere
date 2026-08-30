#!/usr/bin/env bash
#
# CONSIGLIERE — Harness de agentes + memoria persistente para proyectos opencode.
#
# Genera un harness completo (agentes, subagentes, skills, memoria 3 capas) en un
# directorio de proyecto nuevo. Soporta instalación global y desinstalación.
#
# Uso:
#   ./init.sh                          # modo interactivo
#   ./init.sh --install-global         # instalar el generador globalmente
#   ./init.sh --uninstall-global       # desinstalar la versión global
#   ./init.sh --version                # mostrar versión
#   ./init.sh [--dir <ruta>] [--name <n>] [--stack-db <v>] ...   # no-interactivo
#   consigliere-init /ruta/proyecto    # (tras --install-global)
#
# Dependencias: bash 4+, coreutils, git. Opcional: envsubst (gettext), node (autoskills).

set -euo pipefail

VERSION="1.0.0"

# ---------------------------------------------------------------------------
# Configuración de rutas (autodetección: instalado vs source)
# ---------------------------------------------------------------------------
GLOBAL_BIN="$HOME/.local/bin/consigliere-init"
GLOBAL_SHARE="$HOME/.local/share/consigliere"
GLOBAL_TEMPLATES="$GLOBAL_SHARE/templates"

# Portable realpath (fallbacks para macOS / Git Bash sin readlink -f)
realpath_fallback() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$p" 2>/dev/null && return
  fi
  if readlink -f "$p" >/dev/null 2>&1; then
    readlink -f "$p" && return
  fi
  # fallback perl / python (disponible en Git Bash)
  if command -v perl >/dev/null 2>&1; then
    perl -MCwd -e 'print Cwd::abs_path($ARGV[0])' "$p" 2>/dev/null && return
  fi
  # último recurso: ruta sin resolver
  printf '%s' "$p"
}

# Resuelve la ruta real del script (funciona invocado vía PATH o ruta relativa).
resolve_self() {
  local src="${BASH_SOURCE[0]}"
  if [[ "$src" != /* ]]; then
    local resolved
    resolved="$(command -v "$src" 2>/dev/null || true)"
    [[ -n "$resolved" ]] && src="$resolved"
  fi
  realpath_fallback "$src"
}

SCRIPT_PATH="$(resolve_self)"

is_installed_globally() {
  [[ -x "$GLOBAL_BIN" ]] && [[ -d "$GLOBAL_TEMPLATES" ]]
}

is_global_run() {
  [[ "$SCRIPT_PATH" == "$(realpath_fallback "$GLOBAL_BIN")" ]]
}

# Directorio de templates efectivo
if is_global_run; then
  TEMPLATE_DIR="$GLOBAL_TEMPLATES"
  SCRIPT_NAME="consigliere-init"
else
  TEMPLATE_DIR="$(dirname "$SCRIPT_PATH")/templates"
  SCRIPT_NAME="$(basename "$SCRIPT_PATH")"
fi

# ---------------------------------------------------------------------------
# Utilidades (color / banner)
# ---------------------------------------------------------------------------
C_RESET='\033[0m'; C_BOLD='\033[1m'
C_GREEN='\033[32m'; C_CYAN='\033[36m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_DIM='\033[2m'

info()  { printf "${C_CYAN}ℹ️  %s${C_RESET}\n" "$*"; }
ok()    { printf "${C_GREEN}✅ %s${C_RESET}\n" "$*"; }
warn()  { printf "${C_YELLOW}⚠️  %s${C_RESET}\n" "$*"; }
err()   { printf "${C_RED}❌ %s${C_RESET}\n" "$*"; }
step()  { printf "\n${C_BOLD}▶ %s${C_RESET}\n" "$*"; }

banner() {
  printf "${C_CYAN}"
  cat <<'EOF'

                                            ░██           ░██ ░██
                                                          ░██
 ░███████   ░███████  ░████████   ░███████  ░██ ░████████ ░██ ░██ ░███████  ░██░████  ░███████
░██    ░██ ░██    ░██ ░██    ░██ ░██        ░██░██    ░██ ░██ ░██░██    ░██ ░███     ░██    ░██
░██        ░██    ░██ ░██    ░██  ░███████  ░██░██    ░██ ░██ ░██░█████████ ░██      ░█████████
░██    ░██ ░██    ░██ ░██    ░██        ░██ ░██░██   ░███ ░██ ░██░██        ░██      ░██
 ░███████   ░███████  ░██    ░██  ░███████  ░██ ░█████░██ ░██ ░██ ░███████  ░██       ░███████
                                                      ░██
                                                ░███████

EOF
  printf "${C_RESET}${C_DIM}  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v%s)${C_RESET}\n" "$VERSION"
}

# ---------------------------------------------------------------------------
# Instalación global / desinstalación
# ---------------------------------------------------------------------------
install_global() {
  step "Instalando CONSIGLIERE globalmente"

  # Pre-checks de robustez
  if ! bash --version >/dev/null 2>&1; then
    err "No se detectó bash 4+. Abortando."
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    err "No se detectó git. Abortando."
    exit 1
  fi

  mkdir -p "$HOME/.local/bin" "$GLOBAL_SHARE"
  cp "$SCRIPT_PATH" "$GLOBAL_BIN"
  rm -rf "$GLOBAL_TEMPLATES"
  cp -r "$TEMPLATE_DIR" "$GLOBAL_TEMPLATES"
  chmod +x "$GLOBAL_BIN"

  # Verificación de instalación
  if [[ -x "$GLOBAL_BIN" && -d "$GLOBAL_TEMPLATES" ]]; then
    ok "Instalado globalmente."
    # Verificar versión al instante
    VERSION_CHECK="$("$GLOBAL_BIN" --version 2>/dev/null || echo "desconocida")"
    ok "Verificado: $VERSION_CHECK"

    # Detección de PATH (solo bash, sin auto-editar .bashrc)
    CASE_PATH=":$PATH:"
    if [[ "$CASE_PATH" != *":$HOME/.local/bin:"* ]]; then
      warn "⚠️  ~/.local/bin no está en PATH en esta sesión."
      info "Añade manualmente a tu ~/.bashrc (u otros archivos de shell):"
      printf '\n  export PATH="$HOME/.local/bin:$PATH"\n'
      info "Luego ejecuta:  source ~/.bashrc  o abre una nueva terminal  +  hash -r"
      info "Verifica: consigliere-init --version"
    fi

    # Preguntar qué hacer ahora
    read -rp "¿Qué quieres hacer ahora? 1) Crear proyecto ahora  2) Ver pasos y salir  [1-2]: " NEXT_CHOICE
    case "$NEXT_CHOICE" in
      1) interactive_create ;;
      2) print_next_steps_global ;;

      *) info "Opción no reconocida; mostrando pasos." ; print_next_steps_global ;;
    esac
  else
    err "Falló la copia de los binarios. Revise permisos."
    exit 1
  fi
}

uninstall_global() {
  step "Desinstalando versión global"
  local removed=0
  if [[ -e "$GLOBAL_BIN" ]]; then rm -f "$GLOBAL_BIN"; ok "Eliminado: $GLOBAL_BIN"; removed=1; fi
  if [[ -d "$GLOBAL_SHARE" ]]; then rm -rf "$GLOBAL_SHARE"; ok "Eliminado: $GLOBAL_SHARE"; removed=1; fi
  if [[ "$removed" -eq 0 ]]; then info "No había instalación global."; fi
  echo
}

# ---------------------------------------------------------------------------
# Pasos siguientes después de instalación global (en español, sin auto-modificar .bashrc)
# ---------------------------------------------------------------------------
print_next_steps_global() {
  printf '\n'
  printf "  ▶ Qué hacer ahora (pasos copiables):\n"
  printf '    1. Verifica: consigliere-init --version\n'
  printf '       Debe mostrar: CONSIGLIERE v%s\n' "$VERSION"
  printf '    2. Ve a tu proyecto:\n'
  printf '       cd /ruta/a/tu-proyecto   (ej: mkdir -p ~/mi-app && cd ~/mi-app)\n'
  printf '       Si es repo existente vacío: cd ~/mi-proyecto\n'
  printf '    3. Ejecuta: consigliere-init .                (punto = carpeta actual)\n'
  printf '       Alternativa: consigliere-init /ruta/absoluta\n'
  printf '    4. Sigue el asistente: nombre → stack → modelos → autoskills → git\n'
  printf '    5. Dentro del proyecto: cd <proyecto> → edita AGENTS.md\n'
  printf '       y .opencode/skills/_project-docs/SKILL.md\n'
  printf '    6. Arranca: opencode → /discover → /routine "configurar base del proyecto"\n'
  printf '\n'
}

# ---------------------------------------------------------------------------
# Menu principal (cuando ya está instalado globalmente, o sin args)
# ---------------------------------------------------------------------------
show_main_menu() {
  banner
  echo
  if is_installed_globally; then
    ok "CONSIGLIERE ya está instalado globalmente."
    echo "  Comando disponible: $(command -v consigliere-init)"
  else
    info "CONSIGLIERE no está instalado globalmente todavía."
  fi
  echo
  echo "  ¿Qué quieres hacer?"
  echo "  1) Instalar/actualizar globalmente (solo la primera vez)"
  echo "  2) Crear un nuevo proyecto (harness) usando esta copia local"
  echo "  3) Desinstalar la versión global"
  echo "  4) Salir"
  echo
  read -rp "  > Elección [1-4]: " choice
  case "$choice" in
    1) if is_installed_globally; then
         warn "Ya está instalado globalmente."
         print_next_steps_global
       else
         install_global
       fi ;;
    2) interactive_create ;;
    3) confirm_destructive && uninstall_global ;;
    4) exit 0 ;;
    *) warn "Opción inválida."; show_main_menu ;;
  esac
}

confirm_destructive() {
  read -rp "  ¿Seguro? Esto borrará la instalación global. [s/N] " -n 1 -r
  echo
  if [[ ! "$REPLY" =~ ^[Ss]$ ]]; then warn "Cancelado."; exit 0; fi
}

# ---------------------------------------------------------------------------
# Renderizado de templates (siempre sed, valores escapados para robustez)
# ---------------------------------------------------------------------------
sed_escape() {
  printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

render_file() {
  local src="$1" dst="$2"
  local p_name p_db p_backend p_frontend p_auth p_valid p_deploy p_dev
  local p_mo p_mp p_mb p_mv p_mcr p_ms p_me p_lang
  p_name="$(sed_escape "${PROJECT_NAME:-}")"
  p_db="$(sed_escape "${STACK_DB:-}")"
  p_backend="$(sed_escape "${STACK_BACKEND:-}")"
  p_frontend="$(sed_escape "${STACK_FRONTEND:-}")"
  p_auth="$(sed_escape "${STACK_AUTH:-}")"
  p_valid="$(sed_escape "${STACK_VALIDATION:-}")"
  p_deploy="$(sed_escape "${STACK_DEPLOY:-}")"
  p_dev="$(sed_escape "${DEV_COMMANDS:-}")"
  p_mo="$(sed_escape "${MODEL_ORCHESTRATOR:-}")"
  p_mp="$(sed_escape "${MODEL_PLANNER:-}")"
  p_mb="$(sed_escape "${MODEL_BUILDER:-}")"
  p_mv="$(sed_escape "${MODEL_VERIFIER:-}")"
  p_mcr="$(sed_escape "${MODEL_CRITIC:-}")"
  p_ms="$(sed_escape "${MODEL_SUMMARIZER:-}")"
  p_me="$(sed_escape "${MODEL_EXPLORE:-}")"
  p_lang="$(sed_escape "${LANG_BACKEND:-}")"

  sed \
    -e "s|{{PROJECT_NAME}}|$p_name|g" \
    -e "s|{{STACK_DB}}|$p_db|g" \
    -e "s|{{STACK_BACKEND}}|$p_backend|g" \
    -e "s|{{STACK_FRONTEND}}|$p_frontend|g" \
    -e "s|{{STACK_AUTH}}|$p_auth|g" \
    -e "s|{{STACK_VALIDATION}}|$p_valid|g" \
    -e "s|{{STACK_DEPLOY}}|$p_deploy|g" \
    -e "s|{{DEV_COMMANDS}}|$p_dev|g" \
    -e "s|{{MODEL_ORCHESTRATOR}}|$p_mo|g" \
    -e "s|{{MODEL_PLANNER}}|$p_mp|g" \
    -e "s|{{MODEL_BUILDER}}|$p_mb|g" \
    -e "s|{{MODEL_VERIFIER}}|$p_mv|g" \
    -e "s|{{MODEL_CRITIC}}|$p_mcr|g" \
    -e "s|{{MODEL_SUMMARIZER}}|$p_ms|g" \
    -e "s|{{MODEL_EXPLORE}}|$p_me|g" \
    -e "s|{{LANG_BACKEND}}|$p_lang|g" \
    "$src" > "$dst"
}

render_tree() {
  # Copia recursiva de TEMPLATE_DIR a TARGET_DIR, renderizando .md/.json/.mjs/.sh
  local src="$1" dst="$2"
  find "$src" -type d | while read -r d; do
    local rel="${d#"$src"}"; rel="${rel#/}"
    [[ -n "$rel" ]] && mkdir -p "$dst/$rel"
  done
  find "$src" -type f | while read -r f; do
    local rel="${f#"$src"}"; rel="${rel#/}"
    local out="$dst/$rel"
    case "$rel" in
      *.md|*.json|*.mjs|*.sh)
        render_file "$f" "$out"
        chmod --quiet +x "$out" 2>/dev/null || true
        ;;
      *)
        cp "$f" "$out"
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Creación interactiva de proyecto
# ---------------------------------------------------------------------------
interactive_create() {
  banner
  echo
  step "Nuevo proyecto — CONSIGLIERE"
  read -rp "  📁 Ruta del directorio del proyecto: " TARGET_DIR
  TARGET_DIR="${TARGET_DIR/#\~/$HOME}"
  TARGET_DIR="$(cd "$(dirname "$TARGET_DIR")" 2>/dev/null && pwd)/$(basename "$TARGET_DIR")" || TARGET_DIR="$PWD/${TARGET_DIR##*/}"
  local parent; parent="$(dirname "$TARGET_DIR")"
  if [[ ! -d "$parent" ]]; then
    warn "El directorio padre '$parent' no existe. Lo crearé."
  fi
  if [[ -e "$TARGET_DIR" ]] && [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]]; then
    warn "El directorio '$TARGET_DIR' existe y no está vacío."
    read -rp "  ¿Continuar y añadir el harness de todos modos? [s/N] " -n 1 -r; echo
    [[ "$REPLY" =~ ^[Ss]$ ]] || { info "Cancelado."; exit 0; }
  fi

  local default_name; default_name="$(basename "$TARGET_DIR")"
  read -rp "  Nombre del proyecto [$default_name]: " PROJECT_NAME
  PROJECT_NAME="${PROJECT_NAME:-$default_name}"

  echo
  info "Stack (opcional — pre-rellena AGENTS.md y SKILL.md). Enter = saltar."
  prompt_stack_item "Base de datos" STACK_DB "postgresql" "sqlite" "mysql" "mariadb" "mongodb"
  prompt_stack_item "Backend" STACK_BACKEND "node/express" "node/fastify" "nextjs" "python/fastapi" "python/django" "go"
  prompt_stack_item "Frontend" STACK_FRONTEND "react/vite" "nextjs" "astro" "sveltekit" "vue/vite"
  prompt_stack_item "Autenticación" STACK_AUTH "jwt" "session" "oauth2" "cognito" "auth0"
  prompt_stack_item "Validación" STACK_VALIDATION "zod" "valibot" "joi" "yup"
  prompt_stack_item "Deploy" STACK_DEPLOY "docker" "vercel" "fly" "railway" "aws"

  echo
  info "Modelos por subagente (opcional — déjalo vacío para heredar)."
  prompt_model "orchestrator" MODEL_ORCHESTRATOR
  prompt_model "planner" MODEL_PLANNER
  prompt_model "builder" MODEL_BUILDER
  prompt_model "critic" MODEL_CRITIC
  prompt_model "verifier" MODEL_VERIFIER
  prompt_model "summarizer" MODEL_SUMMARIZER
  prompt_model "explore" MODEL_EXPLORE

  # Lenguaje backend para ejemplos (derivado del stack backend)
  case "$STACK_BACKEND" in
    *python*) LANG_BACKEND="python" ;;
    *go*)     LANG_BACKEND="go" ;;
    *)        LANG_BACKEND="typescript" ;;
  esac

  echo
  step "Opciones finales"
  printf '  🤖 Autoskills (skills según dependencias):\n'
  echo "  1) En el proyecto (npx autoskills)   ← Recomendado"
  echo "  2) Global (npm i -g autoskills)"
  echo "  3) Saltar (las instalaré luego)"
  read -rp "  > [1-3]: " AUTO_CHOICE
  AUTO_CHOICE="${AUTO_CHOICE:-1}"

  printf '  📦 Inicializar git + commit inicial? [S/n]: '
  read -rp "" -n 1 GIT_CHOICE; echo
  DO_GIT=1; [[ "$GIT_CHOICE" =~ ^[Nn]$ ]] && DO_GIT=0

  echo
  printf '\n  ${C_BOLD}Resumen:${C_RESET}\n'
  printf "    Proyecto : %s\n" "$PROJECT_NAME"
  printf "    Destino  : %s\n" "$TARGET_DIR"
  printf "    Stack    : %s | %s | %s | auth=%s | val=%s | deploy=%s\n" \
    "$STACK_DB" "$STACK_BACKEND" "$STACK_FRONTEND" "$STACK_AUTH" "$STACK_VALIDATION" "$STACK_DEPLOY"
  printf "    Autoskills: %s | Git init: %s\n" "$AUTO_CHOICE" "$([ "$DO_GIT" = 1 ] && echo Sí || echo No)"
  read -rp "  ¿Continuar? [S/n]: " -n 1 -r; echo
  [[ "$REPLY" =~ ^[Nn]$ ]] && { info "Cancelado."; exit 0; }

  create_project
}

prompt_stack_item() {
  local label="$1" varname="$2"; shift 2
  local opts=("$@")
  printf '  %s:\n' "$label"
  local i; for i in "${!opts[@]}"; do printf '    %d) %s\n' "$((i+1))" "${opts[$i]}"; done
  printf '    %d) Otro... (escribir libre)\n' "$(( ${#opts[@]} + 1 ))"
  printf '    %d) Saltar (dejar vacío)\n' "$(( ${#opts[@]} + 2 ))"
  read -rp "  > Elegir [1-${#opts[@]}] o escribir: " val
  if [[ "$val" =~ ^[0-9]+$ ]]; then
    if [[ "$val" -ge 1 && "$val" -le "${#opts[@]}" ]]; then
      printf -v "$varname" '%s' "${opts[$((val-1))]}"
    else
      printf -v "$varname" '%s' ""
    fi
  else
    printf -v "$varname" '%s' "$val"
  fi
}

prompt_model() {
  local role="$1" varname="$2"
  read -rp "  Modelo [$role] (Enter = heredar): " val
  printf -v "$varname" '%s' "$val"
}

create_project() {
  step "Generando proyecto '$PROJECT_NAME'"
  mkdir -p "$TARGET_DIR"
  ok "Estructura base creada"

  # Renderizar árbol de templates
  render_tree "$TEMPLATE_DIR" "$TARGET_DIR"
  mkdir -p "$TARGET_DIR/CHANGELOG"
  ok "Harness generado (agents, commands, skills, memoria)"

  # Limpiar skills-lock si no aplica (mantener)
  ok "skills-lock.json incluido"

  # Git
  if [[ "$DO_GIT" -eq 1 ]]; then
    git_init_and_commit "$TARGET_DIR"
  else
    warn "Git no inicializado (el hook post-commit de rotación no está activo)."
    info "Puedes activar la rotación con: /rotate-memory (manual) o instalando el hook a mano."
  fi

  # Autoskills
  handle_autoskills "$AUTO_CHOICE" "$TARGET_DIR"

  finish
}

install_git_hook() {
  local repo="$1"
  local hook="$repo/.git/hooks/post-commit"
  local src="$TEMPLATE_DIR/.opencode/hooks/post-commit-memory-rotate.sh"
  if [[ -f "$src" ]]; then
    cp "$src" "$hook"
    chmod +x "$hook"
  fi
}

git_init_and_commit() {
  local repo="$1"
  local author_name="${GIT_AUTHOR_NAME:-CONSIGLIERE}"
  local author_email="${GIT_AUTHOR_EMAIL:-consigliere@local}"
  if [[ ! -d "$repo/.git" ]]; then
    git -C "$repo" init -q
    install_git_hook "$repo"
    git -C "$repo" add .
    git -C "$repo" -c user.name="$author_name" -c user.email="$author_email" \
      commit -q -m "chore: scaffold harness CONSIGLIERE"
    ok "Git + hook post-commit + commit inicial"
  else
    install_git_hook "$repo"
    warn "Ya existía repo git; solo se instaló el hook."
  fi
}

handle_autoskills() {
  local mode="$1" dir="$2"
  case "$mode" in
    2)
      step "Instalando autoskills global"
      if command -v autoskills >/dev/null 2>&1; then
        npm i -g autoskills >/dev/null 2>&1 && ok "autoskills global actualizado" || warn "npm i -g autoskills falló"
      else
        npm i -g autoskills >/dev/null 2>&1 && ok "autoskills global instalado" || warn "npm i -g autoskills falló"
      fi
      info "Corre 'npx autoskills' dentro del proyecto cuando tenga package.json."
      ;;
    3)
      info "Autoskills omitido. Instálalas luego con: cd '$dir' && npx autoskills"
      ;;
    *)
      step "Instalando autoskills en el proyecto"
      if command -v node >/dev/null 2>&1; then
        (cd "$dir" && npx --yes autoskills) && ok "autoskills ejecutado" || warn "autoskills no corrió (¿falta package.json? Instálalo luego: npx autoskills)"
      else
        warn "Node no encontrado. Instala node y corre: cd '$dir' && npx autoskills"
      fi
      ;;
  esac
}

finish() {
  echo
  printf "${C_GREEN}═══════════════════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}🎉  ¡Proyecto '%s' listo en %s!${C_RESET}\n\n" "$PROJECT_NAME" "$TARGET_DIR"
  printf "${C_BOLD}Próximos pasos:${C_RESET}\n"
  printf "  1. cd %s\n" "$TARGET_DIR"
  printf "  2. Edita AGENTS.md → completa el stack y los comandos dev\n"
  printf "  3. Edita .opencode/skills/_project-docs/SKILL.md → URLs/shortcuts de tu stack\n"
  printf "  4. Opcional: rellena los modelos por agente en .opencode/opencode.json\n"
  printf "  5. Si tienes package.json → npm install\n"
  printf "  6. Arranca opencode → /discover (audita contexto + skills) → /routine \"configurar base del proyecto\"\n\n"
  printf "${C_BOLD}Comandos del harness:${C_RESET}\n"
  printf "  /discover [foco]       Audita contexto + skills presentes/faltantes\n"
  printf "  /routine <tarea>       Ciclo completo (plan → critic → build → verify → record)\n"
  printf "  /record <contexto>     Persistir progreso en la memoria\n"
  printf "  /rotate-memory         Rotación semanal manual\n"
  printf "  /compact-state         Compactar PROJECT_STATE.md\n\n"
  printf "${C_BOLD}Memoria persistente (3 capas):${C_RESET}\n"
  printf "  PROJECT_STATE.md  → siempre cargada (fase, decisiones, patrones, pendientes)\n"
  printf "  SUMMARY.md        → última semana (on-demand)\n"
  printf "  CHANGELOG/        → historial semanal archivado (rotación automática post-commit)\n"
}

# ---------------------------------------------------------------------------
# Parser de argumentos / despacho
# ---------------------------------------------------------------------------
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install-global) install_global; exit 0 ;;
      --uninstall-global) confirm_destructive; uninstall_global; exit 0 ;;
      --version|-v) echo "CONSIGLIERE v$VERSION"; exit 0 ;;
      --help|-h) show_help; exit 0 ;;
      --dir) TARGET_DIR="$2"; shift 2 ;;
      --name) PROJECT_NAME="$2"; shift 2 ;;
      --stack-db) STACK_DB="$2"; shift 2 ;;
      --stack-backend) STACK_BACKEND="$2"; shift 2 ;;
      --stack-frontend) STACK_FRONTEND="$2"; shift 2 ;;
      --stack-auth) STACK_AUTH="$2"; shift 2 ;;
      --stack-validation) STACK_VALIDATION="$2"; shift 2 ;;
      --stack-deploy) STACK_DEPLOY="$2"; shift 2 ;;
      --autoskills) AUTO_CHOICE="$2"; shift 2 ;;
      --git) DO_GIT="$([ "$2" = yes ] && echo 1 || echo 0)"; shift 2 ;;
      *) TARGET_DIR="${1/#\~/$HOME}"; shift ;;
    esac
  done
}

show_help() {
  cat <<EOF
CONSIGLIERE v$VERSION — Harness de agentes + memoria persistente para opencode.

Uso:
  $SCRIPT_NAME                          modo interactivo
  $SCRIPT_NAME --install-global         instalar el generador globalmente
  $SCRIPT_NAME --uninstall-global       desinstalar la versión global
  $SCRIPT_NAME --version | --help
  $SCRIPT_NAME <ruta/proyecto>          crear proyecto (no-interactivo, con flags)

Flags (no-interactivo):
  --dir <ruta>              directorio destino
  --name <nombre>           nombre del proyecto
  --stack-db/-backend/-frontend/-auth/-validation/-deploy <v>   stack
  --autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  --git <yes|no>            inicializar git

Genera: .opencode/ (agents, commands, plans, skills), AGENTS.md,
PROJECT_STATE.md, SUMMARY.md, CHANGELOG/, .gitignore, skills-lock.json.

FLUJO RECOMENDADO (principiantes):
  1. Instala globalmente: $SCRIPT_NAME --install-global
  2. Añade ~/.local/bin a tu PATH:
       export PATH="$HOME/.local/bin:$PATH"
       (añade a ~/.bashrc para persistencia, o abre nueva terminal)
  3. Verifica: consigliere-init --version   → debe mostrar CONSIGLIERE v1.0.0
  4. Crea tu proyecto: consigliere-init .    ('.' = carpeta actual)
  5. Sigue el asistente: nombre → stack → modelos → autoskills → git
  6. Dentro del proyecto: edita AGENTS.md y .opencode/skills/_project-docs/SKILL.md
  7. Arranca: opencode → /discover → /routine "configurar base del proyecto"

Para más información, consulta AGENTS.md y templates/.opencode/.
EOF
}

# ---------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------
main() {
  # Si no hay templates disponibles, error
  if [[ ! -d "$TEMPLATE_DIR" ]]; then
    err "No encuentro el directorio de templates en '$TEMPLATE_DIR'."
    err "Si copiaste solo el script, copia también la carpeta templates/."
    exit 1
  fi

  # 1) Flags globales de instalación (siempre disponibles)
  local arg0="${1:-}"
  if [[ "$arg0" == "--install-global" ]]; then install_global; exit 0; fi
  if [[ "$arg0" == "--uninstall-global" ]]; then confirm_destructive; uninstall_global; exit 0; fi
  if [[ "$arg0" == "--version" || "$arg0" == "-v" ]]; then echo "CONSIGLIERE v$VERSION"; exit 0; fi
  if [[ "$arg0" == "--help" || "$arg0" == "-h" ]]; then show_help; exit 0; fi

  # 2) Sin args → menú principal (detección de instalación global)
  if [[ $# -eq 0 ]]; then
    show_main_menu
    exit 0
  fi

  # 3) Con args → parsear flags y crear proyecto
  TARGET_DIR=""; PROJECT_NAME=""; STACK_DB=""; STACK_BACKEND=""; STACK_FRONTEND=""
  STACK_AUTH=""; STACK_VALIDATION=""; STACK_DEPLOY=""; AUTO_CHOICE="1"; DO_GIT="1"
  parse_args "$@"

  if [[ -z "$TARGET_DIR" ]]; then
    err "Falta el directorio destino. Usa --dir <ruta> o pasa una ruta posicional."
    show_help; exit 1
  fi
  [[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="$(basename "$TARGET_DIR")"
  [[ -z "$STACK_DEPLOY" ]] && case "$STACK_BACKEND" in *python*) LANG_BACKEND="python";; *go*) LANG_BACKEND="go";; *) LANG_BACKEND="typescript";; esac
  case "$STACK_BACKEND" in *python*) LANG_BACKEND="python";; *go*) LANG_BACKEND="go";; *) LANG_BACKEND="typescript";; esac
  TARGET_DIR="${TARGET_DIR/#\~/$HOME}"

  # Render (no-interactivo)
  step "Generando proyecto '$PROJECT_NAME'"
  mkdir -p "$TARGET_DIR"
  render_tree "$TEMPLATE_DIR" "$TARGET_DIR"
  mkdir -p "$TARGET_DIR/CHANGELOG"
  ok "Harness generado"
  if [[ "$DO_GIT" -eq 1 ]]; then
    git_init_and_commit "$TARGET_DIR"
  fi
  [[ "$AUTO_CHOICE" != "3" ]] && [[ "$AUTO_CHOICE" != "no" ]] && handle_autoskills "$AUTO_CHOICE" "$TARGET_DIR"
  finish
}

main "$@"
