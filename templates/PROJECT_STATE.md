# PROJECT_STATE — {{PROJECT_NAME}} (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Este archivo es la ÚNICA fuente que los agentes deben leer obligatoriamente al iniciar una sesión. `SUMMARY.md` (última semana) y `CHANGELOG/` (historial archivado) se leen **solo on-demand** cuando la tarea requiere contexto histórico. Estructura/detalle técnico completo: `AGENTS.md` y `.opencode/plans/`.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fase 0 Bootstrap — Harness CLI por proyecto | Harness-only: Node >=18 ESM + Bash 4+ / PowerShell 5.1+ + git/tar; memoria 3 capas md+grep (PROJECT_STATE/SUMMARY/CHANGELOG), routing orgánico y SDD-lite integrados | ✅ Completada |

> Próximo hito: Fase 1 — validar harness en proyecto demo (init.mjs --upgrade, doctor 14/14, flujo /discover → /routine → /record).

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Harness-only sin runtime de app: Node >=18 ESM + Bash/PowerShell + git/tar; sin DB/app server, scaffolding por proyecto vía init.mjs/init.sh/init.ps1 [topic: architecture/harness-scope] review_after: 2026-12-03
- Memoria 3 capas md+grep (PROJECT_STATE/SUMMARY/CHANGELOG) con búsqueda grep+perl y cache fingerprint; SQLite solo fallback [topic: architecture/stack-md-grep] review_after: 2026-12-03
- Skill loader con cache fingerprint `.advisor/skill-registry.cache.json` (path+mtime+size) y chunks urls/patterns/shortcuts/examples/commands bajo demanda [topic: dx/skill-loader-cache] review_after: 2026-12-03

---

## 3. Pendientes inmediatos

- [x] Definir objetivo y alcance inicial del proyecto. (Fase 0 harness-only definido)
- [x] Completar `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md`. (Stack harness documentado)
- [x] Configurar la estructura base del proyecto. (Templates sincronizados)

---

## 4. Índice de historial archivado (CAPA 2)

> `CHANGELOG/YYYY-MM-DD.md` — historial semanal archivado (nombrado por lunes).

| Semana (lunes) | Archivo | Resumen |
|----------------|---------|---------|
| (aún sin historial) | — | — |

> Decisiones superadas: `CHANGELOG/DECISIONS-ARCHIVE.md`.

---

## 5. Patrones de código (Code Patterns)

> Memoria de "cómo se hace X aquí" — reutilizable por planner/builder/critic.

| Patrón | Archivo/Ejemplo | Descripción |
|--------|-----------------|-------------|
| memory/search | `node .opencode/scripts/memory-index.mjs search "query"` → `timeline <id>` → `get <id>` | Búsqueda md+grep progresiva sin SQLite (fallback sqlite3 opcional) |
| skill/chunk-load | `node .opencode/skills/_skill-loader/loader.mjs chunk "_project-docs" urls,patterns` | Carga solo chunks necesarios para ahorrar tokens |

---

## 6. Índices de búsqueda

- **Decisiones**: `PROJECT_STATE.md §2` + `CHANGELOG/DECISIONS-ARCHIVE.md`.
- **Patrones**: `§5` arriba.
- **Features completadas**: `SUMMARY.md` + `CHANGELOG/*.md`.
- **Comandos dev**: `AGENTS.md` sección Development commands.
