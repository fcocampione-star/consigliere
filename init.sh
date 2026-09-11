#!/usr/bin/env bash
#
# ADVISOR 2.0 — Harness de agentes + memoria persistente para proyectos opencode.
# SOLO por proyecto. Sin instalación global.
#
# Uso:
#   ./init.sh                          # modo interactivo
#   ./init.sh --version | --help
#   ./init.sh [--dir <ruta>] [--name <n>] [--stack-db <v>] ...   # no-interactivo
#   npx advisor-harness@latest /ruta/proyecto                          # vía npm (recomendado)
#

set -euo pipefail

VERSION="2.0.0"

# Estado: solo vivo .advisor/ (paridad init.mjs/init.ps1).
# Const ÚNICA BACKUP_ITEMS/PRESERVED — mantener idéntica en los 3 instaladores.
STATE_DIR=".advisor"
BACKUP_ITEMS=(.opencode AGENTS.md PROJECT_STATE.md SUMMARY.md CHANGELOG .advisor opencode.json .gitignore skills-lock.json scripts)
PRESERVED=(PROJECT_STATE.md SUMMARY.md opencode.json AGENTS.md .gitignore)
PART_HARNESS=(.opencode scripts AGENTS.md opencode.json .gitignore skills-lock.json)
PART_MEMORIA=(PROJECT_STATE.md SUMMARY.md CHANGELOG)

if ((BASH_VERSINFO[0] < 4)); then echo "❌ Bash >=4 requerido. Actual: ${BASH_VERSION}" >&2; exit 1; fi

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

needValue() {
  if [[ $# -lt 2 ]] || [[ -z "${2:-}" ]] || [[ "${2:-}" == --* ]]; then
    err "Flag $1 requiere un valor."
    exit 1
  fi
}

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
  p_mo="$(sed_escape "${MODEL_ADVISOR:-}")"
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
    -e "s|{{MODEL_ADVISOR}}|$p_mo|g" \
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
    if [[ -n "$rel" ]]; then mkdir -p "$dst/$rel"; fi
  done
  find "$src" -type f | while read -r f; do
    local rel="${f#"$src"}"; rel="${rel#/}"
    local out="$dst/$rel"
    case "$rel" in
      *.md|*.json|*.mjs|*.sh|*.ps1)
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
  step "Nuevo proyecto — ADVISOR 2.0 (solo por proyecto)"
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
  prompt_model "advisor" MODEL_ADVISOR
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
  ensure_state_dirs "$TARGET_DIR" 0
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
      commit -q -m "chore: scaffold harness ADVISOR 2.0"
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
  printf "  4. Opcional: rellena los modelos por agente en opencode.json (cheap vs strong)\n"
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
  printf "${C_DIM}Instalación 100%% por proyecto — sin binario global. Actualiza con: npx advisor-harness@latest %s --upgrade${C_RESET}\n" "$TARGET_DIR"
}

# Estado vivo / backup / modular ------------------------------------------------
ensure_state_dirs() {
  local target="$1" dry="${2:-0}"
  for sub in "" "backups" "chunks"; do
    if [[ "$dry" -eq 1 ]]; then info "[dry-run] mkdir -p $target/$STATE_DIR/$sub"
    else mkdir -p "$target/$STATE_DIR/$sub"; fi
  done
}

# Backup / modular --------------------------------------------------------
prune_backups() {
  # keep 5 combinado ^(harness|advisor)-*.tgz (paridad mjs/ps1)
  ls -1 "$1"/harness-*.tgz "$1"/advisor-*.tgz 2>/dev/null | sort -r | tail -n +6 | xargs -r rm -f 2>/dev/null || true
}

do_backup() {
  # do_backup <target> <dry> <item...> → deja ruta en $DO_BACKUP_FILE (vacía si nada); aborta si falla
  local target="$1" dry="$2"; shift 2
  DO_BACKUP_FILE=""
  local -a present=()
  local c
  for c in "$@"; do [[ -e "$target/$c" ]] && present+=("$c"); done
  if [[ "${#present[@]}" -eq 0 ]]; then info "Sin harness previo que respaldar (directorio vacío/inexistente)"; return 0; fi
  if [[ "$dry" -eq 1 ]]; then
    info "[dry-run] backup -> $STATE_DIR/backups/advisor-<ts>.tgz (keep 5): ${present[*]}"
    return 0
  fi
  mkdir -p "$target/$STATE_DIR/backups"
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || date +%Y%m%d%H%M%S)"
  local bf="$target/$STATE_DIR/backups/advisor-${ts}.tgz"
  if ! tar -czf "$bf" -C "$target" --exclude="$STATE_DIR/backups" --exclude=.memory-lock "${present[@]}" 2>/dev/null; then
    err "Backup falló: $bf"
    exit 1
  fi
  ok "Backup: $bf (${#present[@]} ítems)"
  prune_backups "$target/$STATE_DIR/backups"
  DO_BACKUP_FILE="$bf"
}

render_selected() {
  # render_selected <part> — renderiza solo subset PART_HARNESS|PART_MEMORIA
  local part="$1"
  local -a allow=()
  if [[ "$part" == "harness" ]]; then allow=("${PART_HARNESS[@]}");
  elif [[ "$part" == "memoria" ]]; then allow=("${PART_MEMORIA[@]}"); fi
  local entry name
  for entry in "$TEMPLATE_DIR"/* "$TEMPLATE_DIR"/.[!.]*; do
    [[ -e "$entry" ]] || continue
    name="$(basename "$entry")"
    local skip=0
    if [[ "${#allow[@]}" -gt 0 ]]; then
      skip=1
      local a; for a in "${allow[@]}"; do [[ "$a" == "$name" ]] && { skip=0; break; }; done
    fi
    [[ "$skip" -eq 1 ]] && continue
    if [[ -d "$entry" ]]; then
      mkdir -p "$TARGET_DIR/$name"
      ( TEMPLATE_SRC="$entry" TEMPLATE_DST="$TARGET_DIR/$name" render_subtree )
    else
      case "$name" in
        *.md|*.json|*.mjs|*.sh|*.ps1) render_file "$entry" "$TARGET_DIR/$name" ;;
        *) cp "$entry" "$TARGET_DIR/$name" ;;
      esac
    fi
  done
}

render_subtree() {
  # helper: render recursivo de $TEMPLATE_SRC -> $TEMPLATE_DST (usa vars globales de render_file)
  local src="$TEMPLATE_SRC" dst="$TEMPLATE_DST"
  find "$src" -type d | while read -r d; do
    local rel="${d#"$src"}"; rel="${rel#/}"
    if [[ -n "$rel" ]]; then mkdir -p "$dst/$rel"; fi
  done
  find "$src" -type f | while read -r f; do
    local rel="${f#"$src"}"; rel="${rel#/}"
    local out="$dst/$rel"
    case "$rel" in
      *.md|*.json|*.mjs|*.sh|*.ps1)
        render_file "$f" "$out"
        chmod --quiet +x "$out" 2>/dev/null || true
        ;;
      *)
        cp "$f" "$out"
        ;;
    esac
  done
}

status_cmd() {
  step "Estado harness '$PROJECT_NAME' (read-only)"
  local is_harness=0
  [[ -d "$TARGET_DIR/.opencode" || -f "$TARGET_DIR/AGENTS.md" ]] && is_harness=1
  local vivo=0
  [[ -d "$TARGET_DIR/$STATE_DIR" ]] && vivo=1
  local active="ninguno"; [[ "$vivo" -eq 1 ]] && active="$STATE_DIR"
  local p_harness=0 p_memoria=0 p_autoskills=0
  [[ -d "$TARGET_DIR/.opencode" ]] && p_harness=1
  [[ -f "$TARGET_DIR/PROJECT_STATE.md" || -f "$TARGET_DIR/SUMMARY.md" || -d "$TARGET_DIR/CHANGELOG" ]] && p_memoria=1
  [[ -d "$TARGET_DIR/.agents/skills" ]] && p_autoskills=1
  local n_backups=0 newest=""
  local bd
  for bd in "$TARGET_DIR/$STATE_DIR/backups"; do
    if [[ -d "$bd" ]]; then
      local c; c="$(ls -1 "$bd" 2>/dev/null | grep -cE '^(harness|advisor)-.*\.tgz$' || true)"
      n_backups=$((n_backups + c))
      local n; n="$(ls -1 "$bd" 2>/dev/null | grep -E '^(harness|advisor)-.*\.tgz$' | sort -r | head -n 1 || true)"
      [[ -n "$n" && ( -z "$newest" || "$n" > "$newest" ) ]] && newest="$bd/$n"
    fi
  done
  local cache="sin cache" cf
  for cf in "$TARGET_DIR/$STATE_DIR/skill-registry.cache.json"; do
    if [[ -f "$cf" ]]; then cache="$cf"; break; fi
  done
  echo "  harness : $([[ "$is_harness" -eq 1 ]] && echo sí || echo no)"
  echo "  estado  : $active (vivo=$vivo)"
  echo "  parts   : harness=$p_harness memoria=$p_memoria autoskills=$p_autoskills"
  echo "  backups : $n_backups (keep 5)${newest:+ → $newest}"
  echo "  cache   : $cache"
  echo "  bin     : npx advisor-harness@latest (alias: consigliere-harness)"
}

restore_cmd() {
  local from="$1" dry="$2"
  step "Restaurar '$PROJECT_NAME' desde backup"
  [[ -n "$from" ]] || { err "--restore requiere --from <archivo.tgz> (advisor-|harness-)."; exit 1; }
  [[ -f "$from" ]] || { err "Backup no encontrado: $from"; exit 1; }
  local base; base="$(basename "$from")"
  [[ "$base" =~ ^(harness|advisor)-.*\.tgz$ ]] || { err "Backup no válido: '$base' (se aceptan advisor-<ts>.tgz y harness-<ts>.tgz)."; exit 1; }
  if [[ "$dry" -eq 1 ]]; then info "[dry-run] tar -xzf $from -C $TARGET_DIR (no se escribió nada)"; return 0; fi
  mkdir -p "$TARGET_DIR"
  tar -xzf "$from" -C "$TARGET_DIR" || { err "Restauración falló (backup intacto en $from)"; exit 1; }
  ok "Restaurado desde $from"
}

uninstall_cmd() {
  local part="$1" dry="$2" force="$3"
  local -a list=()
  case "$part" in
    harness) list=(.opencode scripts AGENTS.md opencode.json .gitignore skills-lock.json) ;;
    memoria) list=(PROJECT_STATE.md SUMMARY.md CHANGELOG "$STATE_DIR") ;;
    autoskills) list=(.agents) ;;
    all) list=(.opencode scripts AGENTS.md opencode.json .gitignore skills-lock.json PROJECT_STATE.md SUMMARY.md CHANGELOG "$STATE_DIR" .agents) ;;
  esac
  local -a present=()
  local c; for c in "${list[@]}"; do [[ -e "$TARGET_DIR/$c" ]] && present+=("$c"); done
  step "Desinstalar '$PROJECT_NAME' --part $part"
  if [[ "${#present[@]}" -eq 0 ]]; then info "Nada que desinstalar (sin archivos del harness)."; return 0; fi
  info "Alcance: ${present[*]}"
  if [[ "$dry" -eq 1 ]]; then info "[dry-run] no se borró nada en disco"; return 0; fi
  if [[ "$force" -eq 0 ]]; then
    if [[ -t 0 ]]; then
      read -rp "  ¿Borrar ${#present[@]} ítems del harness en '$TARGET_DIR'? [s/N] " -n 1 -r; echo
      [[ "$REPLY" =~ ^[Ss]$ ]] || { info "Cancelado (usa --force para no preguntar)."; return 0; }
    else
      err "Sin --force se requiere confirmación interactiva (stdin no es TTY). Abortado."
      exit 1
    fi
  fi
  if [[ "$part" == "memoria" || "$part" == "all" ]]; then
    step "Backup previo obligatorio de memoria"
    local -a mem=(PROJECT_STATE.md SUMMARY.md CHANGELOG "$STATE_DIR")
    do_backup "$TARGET_DIR" 0 "${mem[@]}" || exit 1
    # Copia FUERA del target: el backup interno se borraría con $STATE_DIR/
    if [[ -n "$DO_BACKUP_FILE" ]]; then
      local ext="${TMPDIR:-${TEMP:-/tmp}}/advisor-memoria-$(date +%Y%m%d%H%M%S).tgz"
      cp "$DO_BACKUP_FILE" "$ext" && ok "Copia seguridad externa (sobrevive al borrado): $ext"
    fi
  fi
  local n=0
  for c in "${present[@]}"; do
    rm -rf -- "$TARGET_DIR/$c" 2>/dev/null && n=$((n+1)) || warn "No se pudo borrar $c"
  done
  ok "Desinstalado --part $part: $n/${#present[@]} ítems"
}

# Parser de argumentos / despacho
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version|-v) echo "ADVISOR v$VERSION"; exit 0 ;;
      --help|-h) show_help; exit 0 ;;
      --dir) needValue "$1" "${2:-}"; TARGET_DIR="$2"; shift 2 ;;
      --name) needValue "$1" "${2:-}"; PROJECT_NAME="$2"; shift 2 ;;
      --stack-db) needValue "$1" "${2:-}"; STACK_DB="$2"; shift 2 ;;
      --stack-backend) needValue "$1" "${2:-}"; STACK_BACKEND="$2"; shift 2 ;;
      --stack-frontend) needValue "$1" "${2:-}"; STACK_FRONTEND="$2"; shift 2 ;;
      --stack-auth) needValue "$1" "${2:-}"; STACK_AUTH="$2"; shift 2 ;;
      --stack-validation) needValue "$1" "${2:-}"; STACK_VALIDATION="$2"; shift 2 ;;
      --stack-deploy) needValue "$1" "${2:-}"; STACK_DEPLOY="$2"; shift 2 ;;
      --autoskills) needValue "$1" "${2:-}"; AUTO_CHOICE="$2"; shift 2 ;;
      --git) needValue "$1" "${2:-}"; DO_GIT="$([ "$2" = yes ] && echo 1 || echo 0)"; shift 2 ;;
      --upgrade) UPGRADE=1; shift ;;
      --part) needValue "$1" "${2:-}"; PART="$2"; shift 2 ;;
      --status) STATUS=1; shift ;;
      --restore) RESTORE=1; shift ;;
      --from) needValue "$1" "${2:-}"; FROM="$2"; shift 2 ;;
      --uninstall) UNINSTALL=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --force) FORCE=1; shift ;;
      --*) warn "Flag desconocido: $1"; shift ;;
      *) TARGET_DIR="${1/#\~/$HOME}"; shift ;;
    esac
  done
}

show_help() {
  cat <<EOF
ADVISOR v$VERSION — Harness de agentes + memoria persistente para opencode (solo por proyecto).

Uso:
  $SCRIPT_NAME                          modo interactivo
  $SCRIPT_NAME --version | --help
  $SCRIPT_NAME <ruta/proyecto>          crear proyecto (no-interactivo, con flags)
  $SCRIPT_NAME <ruta/proyecto> --upgrade [--part harness|memoria|autoskills|all]  actualizar (backup keep 5, preserva memoria/config)
  $SCRIPT_NAME <ruta/proyecto> --status   estado read-only (no escribe)
  $SCRIPT_NAME <ruta/proyecto> --restore --from <advisor|harness>-<ts>.tgz  restaurar backup
  $SCRIPT_NAME <ruta/proyecto> --uninstall --part <harness|memoria|autoskills> [--force]  desinstalar
  $SCRIPT_NAME <ruta/proyecto> --dry-run  simulación sin escribir
  $SCRIPT_NAME <ruta/proyecto> --force    sobrescribir destino no vacío

Flags (no-interactivo):
  --dir <ruta>              directorio destino
  --name <nombre>           nombre del proyecto
  --stack-db/-backend/-frontend/-auth/-validation/-deploy <v>   stack
  --autoskills <1|2|3>      1=proyecto, 2=global, 3=omitir
  --git <yes|no>            inicializar git
  --upgrade                 actualizar harness (alias de --part all; backup keep 5; no requiere --force)
  --part <p>                alcance modular: harness|memoria|autoskills|all
  --status                  estado read-only (no escribe)
  --restore --from <tgz>    restaurar backup (acepta advisor- y harness-)
  --uninstall               desinstalar alcance de --part (confirma sin --force; memoria con backup previo)
  --dry-run                 no escribir, solo loguear
  --force                   sobrescribir destino no vacío (solo sin --upgrade) / no pedir confirmación

Estado: vivo en .advisor/.

Genera: .opencode/ (agents, commands, plans, skills, scripts), AGENTS.md,
PROJECT_STATE.md, SUMMARY.md, CHANGELOG/, .advisor/, .gitignore, skills-lock.json.

Instalación — solo por proyecto, sin binario global:
  npx advisor-harness@latest /ruta/proyecto
  node ./init.mjs /ruta/proyecto
  ./init.sh --dir /ruta/proyecto --stack-backend node/express

FLUJO RECOMENDADO:
  1. npx advisor-harness@latest .    ('.' = carpeta actual)
  2. Sigue el asistente: nombre → stack → modelos (cheap vs strong) → autoskills → git
  3. Dentro del proyecto: edita AGENTS.md y .opencode/skills/_project-docs/SKILL.md
  4. Arranca: opencode → /discover → /routine "configurar base del proyecto" → /doctor

Actualización: npx advisor-harness@latest . --upgrade  (backup keep 5 en .advisor/backups/)
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
  if [[ "$arg0" == "--version" || "$arg0" == "-v" ]]; then echo "ADVISOR v$VERSION"; exit 0; fi
  if [[ "$arg0" == "--help" || "$arg0" == "-h" ]]; then show_help; exit 0; fi

  TARGET_DIR=""; PROJECT_NAME=""; STACK_DB=""; STACK_BACKEND=""; STACK_FRONTEND=""
  STACK_AUTH=""; STACK_VALIDATION=""; STACK_DEPLOY=""; AUTO_CHOICE="1"; DO_GIT="1"; UPGRADE=0; DRY_RUN=0; FORCE=0
  PART=""; STATUS=0; RESTORE=0; FROM=""; UNINSTALL=0
  parse_args "$@"

  case "$PART" in ""|harness|memoria|autoskills|all) ;; *) err "--part inválido: '$PART' (usa harness|memoria|autoskills|all)."; exit 1 ;; esac

  if [[ -z "$TARGET_DIR" ]]; then
    err "Falta el directorio destino. Usa --dir <ruta> o pasa una ruta posicional."
    show_help; exit 1
  fi
  [[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="$(basename "$TARGET_DIR")"
  case "$STACK_BACKEND" in *python*) LANG_BACKEND="python";; *go*) LANG_BACKEND="go";; *) LANG_BACKEND="typescript";; esac
  TARGET_DIR="${TARGET_DIR/#\~/$HOME}"

  if [[ "$STATUS" -eq 1 ]]; then status_cmd; exit 0; fi
  if [[ "$RESTORE" -eq 1 ]]; then restore_cmd "$FROM" "$DRY_RUN"; exit 0; fi
  if [[ "$UNINSTALL" -eq 1 ]]; then
    [[ -n "$PART" ]] || { err "--uninstall requiere --part <harness|memoria|autoskills|all>."; exit 1; }
    uninstall_cmd "$PART" "$DRY_RUN" "$FORCE"; exit 0
  fi

  # --upgrade monolítico = --part all (alias)
  if [[ "$UPGRADE" -eq 1 && -z "$PART" ]]; then PART="all"; fi
  scope="${PART:-all}"

  local has_harness=0
  [[ -d "$TARGET_DIR/.opencode" || -f "$TARGET_DIR/AGENTS.md" ]] && has_harness=1
  if [[ -e "$TARGET_DIR" ]] && [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]] && [[ "$FORCE" -eq 0 ]] && [[ "$DRY_RUN" -eq 0 ]]; then
    if [[ "$UPGRADE" -eq 1 ]] && [[ "$has_harness" -eq 1 ]]; then
      : # eximido: harness previo presente → backup + render
    elif [[ "$UPGRADE" -eq 1 ]]; then
      err "El directorio '$TARGET_DIR' no es un proyecto advisor/harness (sin .opencode/ ni AGENTS.md). --upgrade requiere un harness previo; usa --force solo si quieres sobrescribir."
      exit 1
    elif [[ -z "$PART" ]]; then
      err "El directorio '$TARGET_DIR' existe y no está vacío. Usa --force para sobrescribir, --dry-run para simular, o --upgrade para actualizar un harness existente."
      exit 1
    else
      warn "Install --part $PART sobre directorio no vacío (alcance modular)."
    fi
  fi

  local -a items=()
  local bf="" c p
  if [[ "$UPGRADE" -eq 1 ]]; then
    if [[ "$scope" == "autoskills" ]]; then
      step "Actualizando autoskills en '$PROJECT_NAME'"
      if [[ "$DRY_RUN" -eq 1 ]]; then info "[dry-run] handle_autoskills (no se escribió nada)"; finish; exit 0; fi
      handle_autoskills "$AUTO_CHOICE" "$TARGET_DIR"
      finish; exit 0
    fi
    for c in "${BACKUP_ITEMS[@]}"; do
      [[ -e "$TARGET_DIR/$c" ]] && items+=("$c")
    done
    if [[ "${#items[@]}" -eq 0 ]]; then
      info "Sin harness previo que respaldar (directorio vacío/inexistente)"
    elif [[ "$DRY_RUN" -eq 1 ]]; then
      info "[dry-run] backup -> $STATE_DIR/backups/advisor-<ts>.tgz (keep 5): ${items[*]}"
      local -a preview=()
      for c in "${PRESERVED[@]}"; do
        [[ " ${items[*]} " == *" $c "* ]] && preview+=("$c")
      done
      if [[ "${#preview[@]}" -gt 0 ]]; then
        info "[dry-run] restore -> ${preview[*]}"
      fi
      info "[dry-run] would render $TEMPLATE_DIR -> $TARGET_DIR --part $scope (project: $PROJECT_NAME)"
      info "[dry-run] no se escribió nada en disco"
      finish
      exit 0
    else
      step "Actualizando harness en '$PROJECT_NAME' --part $scope (backup keep 5)"
      do_backup "$TARGET_DIR" 0 "${items[@]}"
      bf="$DO_BACKUP_FILE"
    fi
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    info "[dry-run] would render $TEMPLATE_DIR -> $TARGET_DIR --part $scope (project: $PROJECT_NAME)"
    info "[dry-run] no se escribió nada en disco"
    finish
    exit 0
  fi

  if [[ "$UPGRADE" -eq 1 ]]; then step "Generando proyecto '$PROJECT_NAME' (upgrade)${PART:+ (--part $PART)}"
  else step "Generando proyecto '$PROJECT_NAME'${PART:+ (--part $PART)}"; fi
  mkdir -p "$TARGET_DIR"
  case "$scope" in
    harness) render_selected harness ;;
    memoria) render_selected memoria ;;
    autoskills) info "--part autoskills: solo autoskills, sin render" ;;
    *) render_tree "$TEMPLATE_DIR" "$TARGET_DIR" ;;
  esac
  mkdir -p "$TARGET_DIR/CHANGELOG"
  ensure_state_dirs "$TARGET_DIR" 0
  if [[ "${#items[@]}" -gt 0 ]] && [[ -n "$bf" ]]; then
    local -a restored=()
    for p in "${PRESERVED[@]}"; do
      [[ " ${items[*]} " == *" $p "* ]] && restored+=("$p")
    done
    if (( ${#restored[@]} > 0 )); then
      if tar -xzf "$bf" -C "$TARGET_DIR" "${restored[@]}" 2>/dev/null; then
        ok "Memoria/config preservadas: ${restored[*]}"
      else
        warn "Restauración de memoria/config falló (backup en $bf)"
      fi
    fi
  fi
  if [[ "$UPGRADE" -eq 1 ]]; then ok "Harness actualizado (--part $scope)"; else ok "Harness generado${PART:+ (--part $PART)}"; fi
  if [[ "$DO_GIT" -eq 1 ]]; then
    git_init_and_commit "$TARGET_DIR"
  fi
  if [[ "$scope" == "all" || "$scope" == "autoskills" ]]; then
    [[ "$AUTO_CHOICE" != "3" ]] && [[ "$AUTO_CHOICE" != "no" ]] && handle_autoskills "$AUTO_CHOICE" "$TARGET_DIR"
  fi
  finish
}

main "$@"
