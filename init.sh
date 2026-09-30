#!/usr/bin/env bash
#
# Consigliere 2.0 (Advisor Harness) — shim bash: delega todo en init.mjs (única implementación).
# Uso:
#   ./init.sh                              # equivalente a: node init.mjs
#   ./init.sh [ruta/proyecto] [flags...]   # flags de init.mjs (./init.sh --help)
#   npx advisor-harness@latest /ruta/proyecto
#
set -euo pipefail

# Const de versión: solo para el chequeo de fuente única .opencode/scripts/version-check.mjs.
VERSION="2.0.0"

if ((BASH_VERSINFO[0] < 4)); then echo "❌ Bash >=4 requerido. Actual: ${BASH_VERSION}" >&2; exit 1; fi

# Ruta del propio script: relativa, absoluta o a través de symlink.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  LINK_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  if [[ "$SOURCE" != /* ]]; then SOURCE="$LINK_DIR/$SOURCE"; fi
done
HERE="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"

command -v node >/dev/null 2>&1 || { echo "❌ Node no encontrado. Alternativa: npx advisor-harness@latest <ruta/proyecto>" >&2; exit 3; }

exec node "$HERE/init.mjs" "$@"
