#!/usr/bin/env bash
# CONSIGLIERE — Verificación de límites de memoria persistente.
# Comprueba que PROJECT_STATE.md y SUMMARY.md respeten los límites de líneas
# y sugiere la compactación o rotación correspondiente.
#
# Uso:
#   ./scripts/check-memory-limits.sh          (ejecútalo desde la raíz del proyecto)
#   SCRIPT_NAME check-memory-limits.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(pwd)")"
PROJECT_STATE="$PROJECT_ROOT/PROJECT_STATE.md"
SUMMARY="$PROJECT_ROOT/SUMMARY.md"

# Colores simples para output
C_RESET='\033[0m'; C_BOLD='\033[1m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_DIM='\033[2m'

ok()    { printf "${C_GREEN}✅ %s${C_RESET}\n" "$1"; }
warn()  { printf "${C_YELLOW}⚠️  %s${C_RESET}\n" "$1"; }
info()  { printf "${C_DIM}ℹ️  %s${C_RESET}\n" "$1"; }

errors=0

# Verificar PROJECT_STATE.md (capa 0: siempre < ~100 líneas)
if [[ -f "$PROJECT_STATE" ]]; then
  ps_lines="$(wc -l < "$PROJECT_STATE")"
  if [[ "$ps_lines" -gt 100 ]]; then
    warn "PROJECT_STATE.md tiene $ps_lines líneas (límite: 100)."
    info "Ejecuta 'consigliere-init /compact-state' para compactar §2 (decisiones) y §5 (patrones)."
    errors=$((errors + 1))
  else
    ok "PROJECT_STATE.md tiene $ps_lines líneas (dentro del límite de 100)."
  fi
else
  warn "PROJECT_STATE.md no encontrado."
  errors=$((errors + 1))
fi

# Verificar SUMMARY.md (capa 1: on-demand < ~150 líneas)
if [[ -f "$SUMMARY" ]]; then
  s_lines="$(wc -l < "$SUMMARY")"
  if [[ "$s_lines" -gt 150 ]]; then
    warn "SUMMARY.md tiene $s_lines líneas (límite: 150)."
    info "Es probable que sea hora de rotar la entrada más antigua a CHANGELOG/"
    info "Ejecuta 'consigliere-init /rotate-memory' para rotación manual."
    errors=$((errors + 1))
  else
    ok "SUMMARY.md tiene $s_lines líneas (dentro del límite de 150)."
  fi
else
  info "SUMMARY.md no existe aún (se creará al registrar el primer progreso)."
fi

# Reporte final
echo
if [[ "$errors" -gt 0 ]]; then
  warn "Se detectaron $errors problema(s) de límite de memoria."
  info "Revisa los mensajes arriba y aplica las acciones sugeridas."
  exit 1
else
  ok "Todos los límites de memoria están dentro de los rangos esperados."
  exit 0
fi