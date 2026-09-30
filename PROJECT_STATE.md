# PROJECT_STATE — consigliere (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Este archivo es la ÚNICA fuente que los agentes deben leer obligatoriamente al iniciar una sesión. `SUMMARY.md` (última semana) y `CHANGELOG/` (historial archivado) se leen **solo on-demand** cuando la tarea requiere contexto histórico. Estructura/detalle técnico completo: `AGENTS.md` y `.opencode/plans/`.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fase 0 Bootstrap — Harness CLI por proyecto | Harness-only: Node >=18 ESM + Bash 4+ / PowerShell 5.1+ + git/tar; memoria 3 capas md+grep (PROJECT_STATE/SUMMARY/CHANGELOG), routing orgánico y SDD-lite integrados | ✅ Completada |

> Próximo hito: Fase 1 — validar harness en proyecto demo (init.mjs --upgrade, doctor 20 (variable por condicionales §2/topic/manifest/index), flujo /discover → /routine → /record).

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Harness-only sin runtime de app: Node >=18 ESM + Bash/PowerShell + git/tar; sin DB/app server, scaffolding por proyecto vía init.mjs/init.sh/init.ps1 [topic: architecture/harness-scope] review_after: 2026-12-03
- Memoria 3 capas md+grep (PROJECT_STATE/SUMMARY/CHANGELOG) con búsqueda md+grep y cache fingerprint; SQLite solo fallback [topic: architecture/stack-md-grep] review_after: 2026-12-03
- Skill loader con cache fingerprint `.advisor/skill-registry.cache.json` (path+mtime+size) y chunks urls/patterns/shortcuts/examples/commands bajo demanda [topic: dx/skill-loader-cache] review_after: 2026-12-03
- Copia legacy `consigliere/` anidada ignorada vía `/consigliere/` anclado, no commiteable ni parcheable (append-only) [topic: repo/legacy-ignore] review_after: 2026-12-03
- Sunset legacy: solo `.advisor/` vivo, fallback read-only `.consigliere/` eliminado de instaladores/scripts y `.gitignore` (F6) [topic: repo/legacy-sunset] review_after: 2026-12-03
- Advisor-only routing orgánico + SDD-lite ≤650w [topic: sdd/routing-organico] review_after: 2026-12-21
- Lock canónico `memory-lock.mjs` (mkdir atómico + owner.json/token, takeover por rename, stale configurable `ADVISOR_LOCK_STALE_MS`) — sin `flock` [topic: memory/lock-canonico] review_after: 2026-12-21
- `mondayOf` UTC único (memory-sync importa de memory-stats); rotación por lunes de cada entrada [topic: memory/utc-mondayof] review_after: 2026-12-21
- Marcadores `ADVISOR:ENTRIES` + motor único `memory-rotate.mjs`; rotación canónica en `/record`; hook `post-commit` opcional gated [topic: memory/markers-motor] review_after: 2026-12-21
- Routing por clase de riesgo (conteo = desempate); advisor delega deltas; spec-lite persistida y consumida por builder [topic: process/routing-risk-deltas] review_after: 2026-12-21
- Contract tests en `npm test` (paridad espejo raíz↔templates con allowlist, invariantes) [topic: test/contracts-antidrift] review_after: 2026-12-21

---

## 3. Pendientes inmediatos

- [x] Definir objetivo y alcance inicial del proyecto. (Fase 0 harness-only definido)
- [x] Completar `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md`. (Stack harness documentado)
- [x] Configurar la estructura base del proyecto. (Templates sincronizados)
- [x] Copia legacy `consigliere/` no commiteable (ignorada vía `/consigliere/` anclado en `.gitignore`). (Sunset F6: legacy eliminado, solo `.advisor/`)

---

## 4. Índice de historial archivado (CAPA 2)

> `CHANGELOG/YYYY-MM-DD.md` — historial semanal archivado (nombrado por lunes).

| Semana (lunes) | Archivo | Resumen |
|----------------|---------|---------|
| 2026-09-07 | 2026-09-07.md | rotación automática |

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
