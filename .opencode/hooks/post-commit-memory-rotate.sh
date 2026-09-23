#!/usr/bin/env bash
# ADVISOR 2.0 — Hook post-commit: shim delgado del motor de rotación.
# =============================================================================
# DESACTIVADO POR DEFECTO. Es un BACKUP opcional, no el disparador canónico.
# La rotación canónica la ejecuta `/record` → `summarizer` →
# `.opencode/scripts/memory-rotate.mjs rotate` (motor Node, único dueño del lock).
#
# Activación explícita:
#   export ADVISOR_ROTATE_HOOK=1      # o =true/=yes/=on
# Opcional:
#   export ADVISOR_ROTATE_MAX=<N>     # cap de entradas por commit (default motor: 20)
#
# Activado, delega TODO en el motor (no reimplementa parseo, locking ni fechas:
# sin perl / sed -i / flock; no crea `.memory-lock` a mano).
#
# FAIL-LOUD pero NO BLOQUEANTE: cualquier error se registra en
# `.advisor/rotation.log` y el hook SIEMPRE sale 0, para no romper el commit del
# usuario por una falla de mantenimiento de memoria.
# =============================================================================

set -u

HOOK_NAME="post-commit-memory-rotate"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
log_dir="$repo_root/.advisor"
log_file="$log_dir/rotation.log"

log() {
  mkdir -p "$log_dir" 2>/dev/null || return 0
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || echo '?')" "$HOOK_NAME" "$1" >> "$log_file" 2>/dev/null || true
}

# --- Gate: desactivado salvo activación explícita ---------------------------
case "${ADVISOR_ROTATE_HOOK:-}" in
  1|true|TRUE|yes|YES|on|ON) : ;;
  *) exit 0 ;;
esac

engine="$repo_root/.opencode/scripts/memory-rotate.mjs"
if [[ ! -f "$engine" ]]; then
  log "motor no encontrado: $engine (¿harness actualizado con --upgrade?)"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  log "node ausente en PATH; rotación omitida (sin efectos, commit intacto)"
  exit 0
fi

args=(rotate)
if [[ -n "${ADVISOR_ROTATE_MAX:-}" ]]; then
  args+=(--max "$ADVISOR_ROTATE_MAX")
fi

if out="$(node "$engine" "${args[@]}" 2>&1)"; then
  [[ -n "$out" ]] && log "ok: $out"
else
  rc=$?
  log "ERROR (exit $rc): $out"
fi

exit 0
