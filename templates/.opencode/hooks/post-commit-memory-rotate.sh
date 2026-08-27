#!/usr/bin/env bash
# CONSIGLIERE — Rotación automática de memoria tras cada commit.
# Instalado por init.sh en .git/hooks/post-commit.
#
# Rota la entrada más antigua de SUMMARY.md a CHANGELOG/<lunes-semana>.md
# cuando: (a) cambió la semana (lunes), o (b) SUMMARY.md supera ~150 líneas.
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

# ¿Hay al menos una entrada de fecha en SUMMARY?
# Las entradas se añaden al inicio (ver summarizer.md), por lo que la entrada
# más antigua está al final del archivo. Usamos tail -1 para conseguirla.
FIRST_ENTRY_DATE="$(grep -oE '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' "$SUMMARY" | tail -1 | awk '{print $2}')"
[[ -n "$FIRST_ENTRY_DATE" ]] || exit 0

# Contar líneas de contenido de entradas (aproximado).
# Restamos ~4 líneas de cabecera (banner, contexto, separador, índice header).
LINES="$(wc -l < "$SUMMARY")"
LINES=$((LINES - 4))
if [[ "$LINES" -lt 0 ]]; then LINES=0; fi

should_rotate=0
if [[ "$FIRST_ENTRY_DATE" < "$THIS_MONDAY" ]]; then
  should_rotate=1          # la entrada más antigua es de una semana pasada
elif [[ "$LINES" -gt 150 ]]; then
  should_rotate=1          # SUMMARY demasiado largo
fi

if [[ "$should_rotate" -eq 1 ]]; then
  # Extraer la entrada más antigua (último bloque ## YYYY-MM-DD ... hasta el siguiente ## o fin).
  # Usamos perl para localizar y capturar el último bloque de entrada.
  ENTRY="$(perl -0777 -ne '
    # Capturar el último bloque que empieza con "## YYYY-MM-DD" y todo su contenido
    # hasta el siguiente "## " o fin de archivo.
    if (/\n(## \s* [0-9]{4}-[0-9]{2}-[0-9]{2} .+?)(?:\n## |\z)/gs) {
      print $1;
    }
  ' "$SUMMARY")"

  if [[ -n "$ENTRY" ]]; then
    # Crear/abrir changelog
    if [[ ! -f "$CHANGELOG_FILE" ]]; then
      printf '# Changelog %s\n\n> Historial semanal archivado desde SUMMARY.md. Detalle de diffs: `git log`.\n\n' "$THIS_MONDAY" > "$CHANGELOG_FILE"
    fi
    printf '%s\n\n' "$ENTRY" >> "$CHANGELOG_FILE"

    # Borrar la entrada más antigua de SUMMARY.
    # Usamos perl para quitar el último bloque ## fecha y su contenido.
    perl -0777 -pi -e '
      s/\n## \s* [0-9]{4}-[0-9]{2}-[0-9]{2} .+? (?:\n## |\z)//gs;
    ' "$SUMMARY"

    # Actualizar el índice de historial archivado en PROJECT_STATE §4
    # Buscar la sección §4 y actualizar la tabla de semanas archivadas
    if [[ -f "$PROJECT_STATE" ]]; then
      # Añadir la semana rotada al índice si no existe
      WEEK_KEY="| $THIS_MONDAY | $CHANGELOG_FILE |"
      if ! grep -qF "$WEEK_KEY" "$PROJECT_STATE"; then
        # Insertar después de la línea que contiene "## 4. Índice de historial archivado"
        sed -i "/^## 4. Índice de historial archivado/a $WEEK_KEY" "$PROJECT_STATE"
      fi
      # Actualizar el resumen de la semana (opcional: mantener en ~1 línea)
      # Nota: se asume que la compactación real la hace /compact-state manualmente
    fi

    echo "🔄 CONSIGLIERE: memoria rotada → $CHANGELOG_FILE"
  fi
fi