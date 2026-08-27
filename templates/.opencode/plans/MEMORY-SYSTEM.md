# MEMORY-SYSTEM — Sistema de memoria persistente de 3 capas

> Documentación del sistema de contexto persistente generado por CONSIGLIERE.

## Capas

| Capa | Archivo | Carga | Contenido | Límite |
|------|---------|-------|-----------|--------|
| 0 — Estado | `PROJECT_STATE.md` | siempre | fase actual, decisiones de diseño, patrones, pendientes, índices | < ~100 líneas |
| 1 — Reciente | `SUMMARY.md` | on-demand | entradas de la última semana + índice de historial | < ~150 líneas |
| 2 — Archivo | `CHANGELOG/YYYY-MM-DD.md` | rare/on-demand | historial semanal completo (nombrado por lunes) | ilimitado |

## Principios

- **Carga selectiva**: solo PROJECT_STATE se carga siempre. SUMMARY on-demand. CHANGELOG raramente. → eficiente en tokens.
- **Sin listas de archivos**: la fuente de detalle de diffs es `git log`. Las entradas describen qué/por-qué, no qué archivos.
- **Entradas concisas**: 2-4 líneas por entrada. Máximo señal, mínimo ruido.
- **Un solo escritor**: `summarizer` es el único que escribe memoria → consistencia.

## Estructura de entradas (SUMMARY.md)

```markdown
## YYYY-MM-DD — <Título corto>

**Qué:** <2-4 líneas: qué se hizo y por qué, decisiones clave>

**Verificación:** <comandos usados y resultado>
```

## Rotación semanal

- **Trigger**: cambio de semana (lunes) O SUMMARY > ~150 líneas.
- **Acción**: mover la entrada más antigua a `CHANGELOG/<lunes-semana>.md`.
- **Automático**: el hook `hooks/post-commit-memory-rotate.sh` lo ejecuta tras cada commit (instalado por init.sh).
- **Manual**: comando `/rotate-memory`.

## Locking anti-concurrencia

- `mkdir .memory-lock` antes de escribir (lock atómico); `rmdir .memory-lock` al terminar.
- Si el lock existe → espera y reintenta (máx 3), o aborta si hay escritura concurrente.
- `.memory-lock` está en `.gitignore`.

## Compactación de decisiones (§2)

- Cuando `PROJECT_STATE.md §2` supera ~80 líneas, `summarizer` agrupa decisiones relacionadas y mueve las superadas a `CHANGELOG/DECISIONS-ARCHIVE.md`.
- Manual: comando `/compact-state`.

## Patrones de código (§5)

- Memoria de "cómo se hace X aquí": patrón, archivo/ejemplo, descripción.
- Reutilizable por planner/builder/critic para no reinventar.

## Índices (§6)

- Decisiones: `PROJECT_STATE.md §2` + `CHANGELOG/DECISIONS-ARCHIVE.md`.
- Patrones: `PROJECT_STATE.md §5`.
- Features completadas: `SUMMARY.md` + `CHANGELOG/*.md`.
- Comandos dev: `AGENTS.md` sección Development commands.

## Archivos

- `PROJECT_STATE.md` — CAPA 0 (siempre cargado).
- `SUMMARY.md` — CAPA 1 (última semana, on-demand).
- `CHANGELOG/` — CAPA 2 (historial semanal archivado).
- `.memory-lock` — lock anti-concurrencia (no versionado).
- `hooks/post-commit-memory-rotate.sh` — rotación automática post-commit.
