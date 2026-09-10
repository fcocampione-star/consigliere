#!/usr/bin/env bash
# ADVISOR — Rotación automática de memoria tras cada commit.
# Instalado por init.sh en .git/hooks/post-commit.
#
# Rota entradas antiguas de SUMMARY.md a CHANGELOG/<lunes-semana>.md
# cuando: (a) cambió la semana (lunes), o (b) SUMMARY.md supera ~150 líneas.
# El caso (b) se drena en batch (loop con cap 20) hasta quedar <=150.
# Tras rotar, regenera derivados manifest+index (no bloqueante).
#
# Usa flock (contención) para evitar conflictos con escrituras concurrentes.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(pwd)")"
SUMMARY="$REPO_ROOT/SUMMARY.md"
CHANGELOG_DIR="$REPO_ROOT/CHANGELOG"
PROJECT_STATE="$REPO_ROOT/PROJECT_STATE.md"

[[ -f "$SUMMARY" ]] || exit 0
mkdir -p "$CHANGELOG_DIR"

# Lock anti-concurrencia con flock (file descriptor 9)
LOCK_DIR="$REPO_ROOT/.memory-lock"
if [[ -d "$LOCK_DIR" ]]; then
  # Otra escritura en curso; abortar en silencio (la coordinación la hace summarizer)
  exit 0
fi
mkdir -p "$LOCK_DIR"
exec 9>"$LOCK_DIR/.lock"
flock -n 9 || { echo "No se pudo adquirir lock de memoria; reintente en un momento." >&2; exit 1; }
trap 'rm -f "$LOCK_DIR/.lock" 2>/dev/null; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# Detectar lunes de la semana actual (GNU date o BSD date)
if date -d "last monday" +%Y-%m-%d >/dev/null 2>&1; then
  THIS_MONDAY="$(date -d "last monday" +%Y-%m-%d)"
else
  THIS_MONDAY="$(date -v-Mon +%Y-%m-%d)"
fi

CHANGELOG_FILE="$CHANGELOG_DIR/$THIS_MONDAY.md"

# Recalcula FIRST_ENTRY_DATE (entrada más antigua = última ## del archivo,
# las entradas se añaden al inicio según summarizer.md) y LINES (contenido
# aproximado restando ~4 líneas de cabecera).
summary_stats() {
  FIRST_ENTRY_DATE="$(grep -oE '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' "$SUMMARY" | tail -1 | awk '{print $2}' || true)"
  LINES="$(wc -l < "$SUMMARY")"
  LINES=$((LINES - 4))
  if [[ "$LINES" -lt 0 ]]; then LINES=0; fi
}

# Rota UNA entrada (la más antigua) a CHANGELOG/<lunes>.md.
# Retorna 0 si rotó, 1 si no había nada que rotar. Suma a ROTATED.
rotate_one() {
  local entry
  entry="$(perl -0777 -ne '
    if (/\n(##\s*[0-9]{4}-[0-9]{2}-[0-9]{2} .+?)(?:\n## |\z)/gs) {
      print $1;
    }
  ' "$SUMMARY")"

  [[ -n "$entry" ]] || return 1
  if [[ ! -f "$CHANGELOG_FILE" ]]; then
    printf '# Changelog %s\n\n> Historial semanal archivado desde SUMMARY.md. Detalle de diffs: `git log`.\n\n' "$THIS_MONDAY" > "$CHANGELOG_FILE"
  fi
  printf '%s\n\n' "$entry" >> "$CHANGELOG_FILE"
  # Una sola sustitución (sin /g) + lookahead: elimina exactamente la
  # primera entrada sin consumir el delimitador `\n## ` de la siguiente.
  perl -0777 -pi -e '
    s/\n##\s*[0-9]{4}-[0-9]{2}-[0-9]{2} .+?(?=\n## |\z)//s;
  ' "$SUMMARY"
  if [[ -f "$PROJECT_STATE" ]]; then
    WEEK_KEY="| $THIS_MONDAY | $CHANGELOG_FILE |"
    if ! grep -qF "$WEEK_KEY" "$PROJECT_STATE"; then
      sed -i "/^## 4. Índice de historial archivado/a $WEEK_KEY" "$PROJECT_STATE"
    fi
  fi
  echo "🔄 ADVISOR 2.0: memoria rotada → $CHANGELOG_FILE"
  ROTATED=$((ROTATED + 1))
  return 0
}

ROTATED=0
summary_stats
[[ -n "${FIRST_ENTRY_DATE:-}" ]] || exit 0

# 1) Rotación semanal: la entrada más antigua es de una semana pasada.
if [[ "$FIRST_ENTRY_DATE" < "$THIS_MONDAY" ]]; then
  rotate_one || true
  summary_stats
fi

# 2) Batch: drenar hasta SUMMARY <=150 líneas (cap 20 por commit).
iter=0
while [[ "$LINES" -gt 150 ]]; do
  if [[ "$iter" -ge 20 ]]; then
    echo "ADVISOR 2.0: límite batch (20) alcanzado; SUMMARY sigue >150 líneas." >&2
    break
  fi
  rotate_one || break
  iter=$((iter + 1))
  summary_stats
  [[ -n "${FIRST_ENTRY_DATE:-}" ]] || break
done

# 3) Regenerar derivados manifest+index si hubo rotación (no bloqueante).
if [[ "$ROTATED" -gt 0 ]]; then
  if [[ -f "$REPO_ROOT/.opencode/scripts/memory-sync.mjs" ]] && command -v node >/dev/null 2>&1; then
    node "$REPO_ROOT/.opencode/scripts/memory-sync.mjs" buildManifest >/dev/null 2>&1 || true
    node "$REPO_ROOT/.opencode/scripts/memory-sync.mjs" buildIndex >/dev/null 2>&1 || true
  fi
fi
