#!/usr/bin/env bash
#
# CONSIGLIERE 2.0 — Harness de agentes + memoria persistente para proyectos opencode.
# SOLO por proyecto. Sin instalación global.
#
# Uso:
#   ./init.sh                          # modo interactivo
#   ./init.sh --version | --help
#   ./init.sh [--dir <ruta>] [--name <n>] [--stack-db <v>] ...   # no-interactivo
#   npx consigliere-init /ruta/proyecto                            # vía npm (recomendado)
#

set -euo pipefail

VERSION="2.0.0"

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
TEMPLATE_DIR="$(dirname "$SCRIPT_PATH")/templates"
SCRIPT_NAME="$(basename "$SCRIPT_PATH")"

# Utilidades (color / banner)
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
  printf "${C_RESET}${C_DIM}  Harness Genérico — Agent Pipeline + Memoria Persistente 3 Capas (v%s · solo por proyecto)${C_RESET}\n" "$VERSION"
}

# Renderizado de templates
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

# Creación interactiva de proyecto
interactive_create() {
  banner
  echo
  step "Nuevo proyecto — CONSIGLIERE 2.0 (solo por proyecto)"
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
  info "Modelos por subagente (opcional — cheap=verifier/summarizer/explore, strong=builder/planner/critic)."
  prompt_model "orchestrator" MODEL_ORCHESTRATOR
  prompt_model "planner" MODEL_PLANNER
  prompt_model "builder" MODEL_BUILDER
  prompt_model "critic" MODEL_CRITIC
  prompt_model "verifier" MODEL_VERIFIER
  prompt_model "summarizer" MODEL_SUMMARIZER
  prompt_model "explore" MODEL_EXPLORE

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
  render_tree "$TEMPLATE_DIR" "$TARGET_DIR"
  mkdir -p "$TARGET_DIR/CHANGELOG"
  mkdir -p "$TARGET_DIR/.consigliere/backups"
  mkdir -p "$TARGET_DIR/.consigliere/chunks"
  ok "Harness generado (agents, commands, skills, memoria, scripts)"
  if [[ "$DO_GIT" -eq 1 ]]; then
    git_init_and_commit "$TARGET_DIR"
  else
    warn "Git no inicializado (el hook post-commit de rotación no está activo)."
  fi
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
      commit -q -m "chore: scaffold harness CONSIGLIERE 2.0"
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
      npm i -g autoskills >/dev/null 2>&1 && ok "autoskills global instalado" || warn "npm i -g autoskills falló"
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
  printf "  4. Opcional: rellena los modelos por agente en .opencode/opencode.json (cheap vs strong)\n"
  printf "  5. Si tienes package.json → npm install\n"
  printf "  6. Arranca opencode → /discover (audita contexto + skills) → /routine \"configurar base del proyecto\"\n"
  printf "  7. Verifica: /doctor · node .opencode/scripts/memory-index.mjs search \"query\"\n\n"
  printf "${C_BOLD}Comandos del harness:${C_RESET}\n"
  printf "  /discover [foco]       Audita contexto + skills presentes/faltantes\n"
  printf "  /routine <tarea>       Ciclo completo (plan→spec→critic→build→verify→record)\n"
  printf "  /doctor                Diagnóstico del harness y memoria\n"
  printf "  /record <contexto>     Persistir progreso en la memoria\n"
  printf "  /review                Listar decisiones stale (review_after)\n"
  printf "  /rotate-memory         Rotación semanal manual\n"
  printf "  /compact-state         Compactar PROJECT_STATE.md\n\n"
  printf "${C_DIM}Instalación 100%% por proyecto — sin binario global. Actualiza con: npx consigliere@latest %s --upgrade${C_RESET}\n" "$TARGET_DIR"
}

# Parser de argumentos / despacho
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
      --upgrade) UPGRADE=1; shift ;;
      *) TARGET_DIR="${1/#\~/$HOME}"; shift ;;
    esac
  done
}

show_help() {
  cat <<EOF
CONSIGLIERE v$VERSION — Harness de agentes + memoria persistente para opencode (solo por proyecto).

Uso:
  $SCRIPT_NAME                          modo interactivo
  $SCRIPT_NAME --version | --help
  $SCRIPT_NAME <ruta/proyecto>          crear proyecto (no-interactivo, con flags)
  $SCRIPT_NAME <ruta/proyecto> --upgrade  actualizar harness existente (backup keep 5)

Flags (no-interactivo):
  --dir <ruta>              directorio destino
  --name <nombre>           nombre del proyecto
  --stack-db/-backend/-frontend/-auth/-validation/-deploy <v>   stack
  --autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  --git <yes|no>            inicializar git
  --upgrade                 actualizar harness (backup .consigliere/backups/)

Genera: .opencode/ (agents, commands, plans, skills, scripts), AGENTS.md,
PROJECT_STATE.md, SUMMARY.md, CHANGELOG/, .consigliere/, .gitignore, skills-lock.json.

Instalación — solo por proyecto, sin binario global:
  npx consigliere@latest /ruta/proyecto
  node ./init.mjs /ruta/proyecto
  ./init.sh --dir /ruta/proyecto --stack-backend node/express

FLUJO RECOMENDADO:
  1. npx consigliere@latest .    ('.' = carpeta actual)
  2. Sigue el asistente: nombre → stack → modelos (cheap vs strong) → autoskills → git
  3. Dentro del proyecto: edita AGENTS.md y .opencode/skills/_project-docs/SKILL.md
  4. Arranca: opencode → /discover → /routine "configurar base del proyecto" → /doctor

Actualización: npx consigliere@latest . --upgrade  (backup keep 5 en .consigliere/backups/)
EOF
}

# Punto de entrada
main() {
  if [[ ! -d "$TEMPLATE_DIR" ]]; then
    err "No encuentro el directorio de templates en '$TEMPLATE_DIR'."
    err "Si clonaste el repo, ejecuta desde la raíz: ./init.sh /ruta/proyecto"
    exit 1
  fi

  if [[ $# -eq 0 ]]; then
    interactive_create
    exit 0
  fi

  local arg0="${1:-}"
  if [[ "$arg0" == "--version" || "$arg0" == "-v" ]]; then echo "CONSIGLIERE v$VERSION"; exit 0; fi
  if [[ "$arg0" == "--help" || "$arg0" == "-h" ]]; then show_help; exit 0; fi

  TARGET_DIR=""; PROJECT_NAME=""; STACK_DB=""; STACK_BACKEND=""; STACK_FRONTEND=""
  STACK_AUTH=""; STACK_VALIDATION=""; STACK_DEPLOY=""; AUTO_CHOICE="1"; DO_GIT="1"; UPGRADE=0
  parse_args "$@"

  if [[ -z "$TARGET_DIR" ]]; then
    err "Falta el directorio destino. Usa --dir <ruta> o pasa una ruta posicional."
    show_help; exit 1
  fi
  [[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="$(basename "$TARGET_DIR")"
  case "$STACK_BACKEND" in *python*) LANG_BACKEND="python";; *go*) LANG_BACKEND="go";; *) LANG_BACKEND="typescript";; esac
  TARGET_DIR="${TARGET_DIR/#\~/$HOME}"

  if [[ "$UPGRADE" -eq 1 ]]; then
    step "Actualizando harness en '$PROJECT_NAME' (backup keep 5)"
    mkdir -p "$TARGET_DIR/.consigliere/backups"
    local ts; ts="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || date +%Y%m%d%H%M%S)"
    local bf="$TARGET_DIR/.consigliere/backups/harness-${ts}.tgz"
    tar -czf "$bf" -C "$TARGET_DIR" .opencode AGENTS.md PROJECT_STATE.md SUMMARY.md 2>/dev/null && ok "Backup: $bf" || warn "Backup falló (continuando)"
    # prune keep 5
    local count; count="$(ls -1 "$TARGET_DIR/.consigliere/backups"/harness-*.tgz 2>/dev/null | wc -l)"
    if [[ "$count" -gt 5 ]]; then
      ls -1t "$TARGET_DIR/.consigliere/backups"/harness-*.tgz | tail -n +6 | xargs rm -f 2>/dev/null || true
    fi
  fi

  step "Generando proyecto '$PROJECT_NAME'${UPGRADE:+ (upgrade)}"
  mkdir -p "$TARGET_DIR"
  render_tree "$TEMPLATE_DIR" "$TARGET_DIR"
  mkdir -p "$TARGET_DIR/CHANGELOG"
  mkdir -p "$TARGET_DIR/.consigliere/backups"
  mkdir -p "$TARGET_DIR/.consigliere/chunks"
  ok "Harness ${UPGRADE:+actualizado }generado"
  if [[ "$DO_GIT" -eq 1 ]]; then
    git_init_and_commit "$TARGET_DIR"
  fi
  [[ "$AUTO_CHOICE" != "3" ]] && [[ "$AUTO_CHOICE" != "no" ]] && handle_autoskills "$AUTO_CHOICE" "$TARGET_DIR"
  finish
}

main "$@"
