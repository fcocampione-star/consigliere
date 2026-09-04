# MEMORY-SYSTEM 2.0 — Sistema de memoria persistente de 3 capas (md+grep, topic upsert)

> Documentación del sistema de contexto persistente generado por CONSIGLIERE 2.0. Inspirado en Engram (SQLite+FTS5) pero **solo md+grep, sin SQLite**.

## Capas

| Capa | Archivo | Carga | Contenido | Límite |
|------|---------|-------|-----------|--------|
| 0 — Estado | `PROJECT_STATE.md` | siempre | fase, decisiones + `review_after` + `topic:`, patrones, pendientes, índices | < ~100 líneas (§2 <80) |
| 1 — Reciente | `SUMMARY.md` | on-demand | entradas última semana + `topic: family/kebab` + índice | < ~150 líneas |
| 2 — Archivo | `CHANGELOG/YYYY-MM-DD.md` | rare/on-demand | historial semanal (lunes) + `DECISIONS-ARCHIVE.md` | ilimitado |

## Principios 2.0

- **Carga selectiva**: solo STATE siempre. SUMMARY on-demand. CHANGELOG raramente. Eficiente en tokens.
- **Sin listas de archivos**: fuente `git log`.
- **Entradas 5 campos + topic upsert**: `Goal/Discoveries/Accomplished/Next/Files` + `topic: family/kebab` (2 niveles). Mismo topic en 7d → **upsert** no duplicar (dedup hash title+topic).
- **Búsqueda progresiva (md+grep)**: `search → timeline → get` via `memory-index.mjs` (sin SQLite).
- **Un solo escritor**: `summarizer` es el único que escribe memoria.
- **Review_after**: decisiones llevan `review_after: YYYY-MM-DD` (+90d). `/review` lista stale (`needs_review`).

## Estructura de entradas (SUMMARY.md) 2.0

```markdown
## YYYY-MM-DD — <Título corto>

topic: <family/kebab>  <!-- ej architecture/auth, sdd/login/spec -->
review_after: YYYY-MM-DD  <!-- solo si decisión -->
**Goal:** <objetivo>
**Discoveries:** <hallazgos>
**Accomplished:** <qué se hizo y decisiones>
**Next:** <siguientes pasos>
**Verificación:** <comandos y resultado>
```
Compat: viejo `**Qué:**/**Verificación:**` se migra a 5 campos.

## Rotación semanal

- **Trigger**: lunes O SUMMARY > ~150 líneas.
- **Acción**: mover entrada más antigua a `CHANGELOG/<lunes>.md`.
- **Automático**: hook `post-commit-memory-rotate.sh` tras cada commit + `memory-sync.mjs export` a `.consigliere/chunks/` (no bloqueante).
- **Manual**: `/rotate-memory`.

## Búsqueda progresiva (md+grep, sin SQLite)

- `node .opencode/scripts/memory-index.mjs search "query"` → IDs
- `node .opencode/scripts/memory-index.mjs timeline <id>`
- `node .opencode/scripts/memory-index.mjs get <id>` → full body
- Índices §6: `PROJECT_STATE §2` + `CHANGELOG/DECISIONS-ARCHIVE.md` + `SUMMARY` + `CHANGELOG/*.md`

## Sync local (sin cloud)

- `node .opencode/scripts/memory-sync.mjs export [--all]` → `.consigliere/chunks/<monday>.json`
- `node .opencode/scripts/memory-sync.mjs import` → restaura `CHANGELOG/` en clone
- `node .opencode/scripts/memory-sync.mjs status`
- `.consigliere/chunks/` puede versionarse (recomendado) o gitignorar.

## Locking anti-concurrencia

- `mkdir .memory-lock` (atómico); `rmdir` al terminar; retry 3×2s; `.gitignore`.

## Compactación y dedup (§2)

- §2 >80 líneas → agrupa relacionadas, mueve obsoletas a `DECISIONS-ARCHIVE.md`, dedup hash `title+topic`.
- Manual: `/compact-state`.

## Skill cache

- `.consigliere/skill-registry.cache.json` fingerprint `path+mtime+size` (versión 1), generado por `loader.mjs` en `list`/`search`, `refresh --force` invalida.

## Patrones §5

- `Patrón | Archivo | Descripción` — 1 línea por patrón, reutilizable.

## Comandos

- `/doctor` — health check (doctor.mjs) + `/review` stale + `/record` 5 campos + topic

## Archivos 2.0

- `PROJECT_STATE.md` — CAPA 0, con `review_after` + `topic:`
- `SUMMARY.md` — CAPA 1, con `topic:` + 5 campos
- `CHANGELOG/` — CAPA 2 + `DECISIONS-ARCHIVE.md`
- `.memory-lock`, `.consigliere/skill-registry.cache.json`, `.consigliere/chunks/`, `.consigliere/backups/`
- `hooks/post-commit-memory-rotate.sh` + `scripts/memory-index.mjs|memory-sync.mjs|doctor.mjs`
