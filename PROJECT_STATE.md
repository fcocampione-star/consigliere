# PROJECT_STATE — consigliere (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Este archivo es la ÚNICA fuente que los agentes deben leer obligatoriamente al iniciar una sesión. `SUMMARY.md` (última semana) y `CHANGELOG/` (historial archivado) se leen **solo on-demand** cuando la tarea requiere contexto histórico. Estructura/detalle técnico completo: `AGENTS.md` y `.opencode/plans/`.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fase 0 Bootstrap — Harness CLI por proyecto | Harness-only: Node >=20.11 ESM (usa `import.meta.dirname`) + Bash 4+ / PowerShell 5.1+ + git/tar; memoria 3 capas md+grep (PROJECT_STATE/SUMMARY/CHANGELOG), routing orgánico y SDD-lite integrados | ✅ Completada |
| Fase 0.5 Hardening — Refactor + CI (PR-0…PR-7) | Instalador Node-only con init.mjs como única implementación, suite de tests sin deps, `lib/` compartida, CI con matriz y release gateada, docs reales | ✅ Completada |

> Próximo hito: Fase 1 — validar harness en proyecto demo (init.mjs --upgrade, doctor (variable por condicionales §2/topic/manifest/index), flujo /discover → /routine → /record) con la suite y la CI como puerta.

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Harness-only sin runtime de app: Node >=20.11 ESM (usa `import.meta.dirname`) + Bash/PowerShell + git/tar; sin DB/app server, scaffolding por proyecto vía init.mjs/init.sh/init.ps1 [topic: architecture/harness-scope] review_after: 2026-12-03
- Memoria 3 capas md+grep (PROJECT_STATE/SUMMARY/CHANGELOG) con búsqueda md+grep y cache fingerprint; sin base de datos ni fallback SQLite (no existe en el código) [topic: architecture/stack-md-grep] review_after: 2026-12-03
- Skill loader con cache fingerprint `.advisor/skill-registry.cache.json` (path+mtime+size) y chunks urls/patterns/shortcuts/examples/commands bajo demanda [topic: dx/skill-loader-cache] review_after: 2026-12-03
- Copia legacy `consigliere/` anidada ignorada vía `/consigliere/` anclado, no commiteable ni parcheable (append-only) [topic: repo/legacy-ignore] review_after: 2026-12-03
- Sunset legacy: solo `.advisor/` vivo, fallback read-only `.consigliere/` eliminado de instaladores/scripts y `.gitignore` (F6) [topic: repo/legacy-sunset] review_after: 2026-12-03
- Advisor-only routing orgánico + SDD-lite ≤650w [topic: sdd/routing-organico] review_after: 2026-12-21
- Lock canónico `memory-lock.mjs` (mkdir atómico + owner.json/token, takeover por rename, stale configurable `ADVISOR_LOCK_STALE_MS`) — sin `flock` [topic: memory/lock-canonico] review_after: 2026-12-21
- `mondayOf` UTC único (memory-sync importa de memory-stats); rotación por lunes de cada entrada [topic: memory/utc-mondayof] review_after: 2026-12-21
- Marcadores `ADVISOR:ENTRIES` + motor único `memory-rotate.mjs`; rotación canónica en `/record`; hook `post-commit` opcional gated [topic: memory/markers-motor] review_after: 2026-12-21
- Routing por clase de riesgo (conteo = desempate); advisor delega deltas; spec-lite persistida y consumida por builder [topic: process/routing-risk-deltas] review_after: 2026-12-21
- Contract tests en `npm test` (paridad espejo raíz↔templates con allowlist, invariantes) [topic: test/contracts-antidrift] review_after: 2026-12-21
- Suelo de runtime real Node >=20.11 (15 scripts usan `import.meta.dirname`); `engines: >=18` mentía y la matriz de CI fija la versión [topic: runtime/node-floor] review_after: 2027-03-30
- Instalador Node-only: `init.mjs` es la única implementación y `init.sh`/`init.ps1`/`init.cmd` son lanzadores (~20 líneas) — Node es requisito duro de toda vía de instalación [topic: installer/node-only] review_after: 2027-03-30
- `--upgrade` separa memoria PRESERVADA (PROJECT_STATE/SUMMARY/CHANGELOG) de config REGENERADA (AGENTS.md/opencode.json/.gitignore) y conserva los `model:` por agente; antes la config se restauraba del backup y no se actualizaba nunca [topic: installer/upgrade-split] review_after: 2027-03-30
- Backup previo obligatorio antes de CUALQUIER escritura en destino no vacío (antes solo al actualizar); `--dry-run` no escribe ni anuncia éxito [topic: installer/backup-previo] review_after: 2027-03-30
- Suite propia sin dependencias (`test/run.mjs`) + CI de 5 jobs con matriz 3 SO × Node 20/22/24 y publicación gateada en CI; cero dependencias en runtime [topic: test/ci-gate] review_after: 2027-03-30
- El gate de free tier de opencode (`{{MODEL_*}}` sin entitlement) se documenta y no se sortea en código: el harness valida la forma del id, nunca el entitlement [topic: dx/free-tier-doc] review_after: 2027-03-30

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
| memory/search | `node .opencode/scripts/memory-index.mjs search "query"` → `timeline <id>` → `get <id>` | Búsqueda md+grep progresiva, cero dependencias (sin DB) |
| skill/chunk-load | `node .opencode/skills/_skill-loader/loader.mjs chunk "_project-docs" urls,patterns` | Carga solo chunks necesarios para ahorrar tokens |
| test/suite | `npm test` · `npm run test:unit` (agregador `node test/run.mjs`, 1 proceso por fichero) · `npm run test:contract` | Micro-framework sin deps en `test/harness.mjs`; `test:contract` = anti-drift (falla en raíz no catalogada) |
| shared-lib | `.opencode/scripts/lib/{core,md,cache}.mjs` | Núcleo sin deps (isMain, readText, sectionText, field, fenceSpans, listChangelog, todayUTC, writeAtomic, fingerprint/isFresh, EXIT_CODES): importar, nunca reimplementar |
| lint/version | `npm run lint:sh` · `npm run lint:ps1` · `npm run version:check` | `bash -n`, parse AST de PowerShell y versión única (package.json == init.mjs/init.sh/init.ps1) |
| installer | `node init.mjs <dir> --upgrade --quick` (exit 0/1/2/3/4/5) | Entrada única; los shims delegan; contrato de exit codes en `lib/core.mjs EXIT_CODES` |

---

## 6. Índices de búsqueda

- **Decisiones**: `PROJECT_STATE.md §2` + `CHANGELOG/DECISIONS-ARCHIVE.md`.
- **Patrones**: `§5` arriba.
- **Features completadas**: `SUMMARY.md` + `CHANGELOG/*.md`.
- **Comandos dev**: `AGENTS.md` sección Development commands + `CONTRIBUTING.md` (flujo, quirks de CI).
