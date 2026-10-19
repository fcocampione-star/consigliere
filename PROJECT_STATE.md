# PROJECT_STATE — consigliere (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Este archivo es la ÚNICA fuente que los agentes deben leer obligatoriamente al iniciar una sesión. `SUMMARY.md` (última semana) y `CHANGELOG/` (historial archivado) se leen **solo on-demand** cuando la tarea requiere contexto histórico. Estructura/detalle técnico completo: `AGENTS.md` y `.opencode/plans/`.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fases 0/0.5/1 — Bootstrap/hardening/validación demo | Harness CLI Node-only + suite sin deps + `doctor` 0❌/0⚠️ + límites en verde | ✅ Completadas |
| Modelo D2 + release npm 1.0 | `dev` = integración / `main` = estable (ambas repo completo, promoción `--ff-only`); `advisor-harness@1.0.1` en npm, contrato git-aware, `lint:sh`/PATH resuelto | ✅ Completadas |

> Próximo hito: ninguno bloqueante — `1.0.1` publicada y verificada desde el registry, Fase 1 cerrada. Pendientes menores no bloqueantes en §3.

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Harness-only sin app server: Node >=20.11 ESM + Bash/PowerShell + git/tar; scaffolding vía init.mjs/sh/ps1 [topic: architecture/harness-scope] review_after: 2026-12-03
- Memoria 3 capas md+grep (STATE/SUMMARY/CHANGELOG) con fingerprint path+mtime+size; sin DB ni SQLite [topic: architecture/stack-md-grep] review_after: 2026-12-03
- Skill loader con cache fingerprint `.advisor/skill-registry.cache.json` y chunks bajo demanda [topic: dx/skill-loader-cache] review_after: 2026-12-03
- Sunset legacy: solo `.advisor/` vivo, fallback read-only `.consigliere/` eliminado de instaladores/scripts y `.gitignore` (F6) [topic: repo/legacy-sunset] review_after: 2026-12-03
- Advisor-only routing orgánico + SDD-lite ≤650w [topic: sdd/routing-organico] review_after: 2026-12-21
- Lock `memory-lock.mjs` (mkdir atómico + owner.json/token, takeover por rename, stale `ADVISOR_LOCK_STALE_MS`); sin `flock` [topic: memory/lock-canonico] review_after: 2026-12-21
- `mondayOf` UTC único (memory-sync importa de memory-stats); rotación por lunes de cada entrada [topic: memory/utc-mondayof] review_after: 2026-12-21
- Marcadores `ADVISOR:ENTRIES` + motor `memory-rotate.mjs`; rotación en `/record`; hook post-commit gated [topic: memory/markers-motor] review_after: 2026-12-21
- Routing por clase de riesgo (conteo = desempate); advisor delega deltas; spec-lite persistida y consumida por builder [topic: process/routing-risk-deltas] review_after: 2026-12-21
- Contract tests en `npm test` (paridad raíz↔templates con allowlist; `ls-files` respeta `.gitignore`, incl. test/contract-git-aware) [topic: test/contracts-antidrift] review_after: 2026-12-21
- Runtime real Node >=20.11 (`import.meta.dirname` en 15 scripts); `engines: >=18` mentía; CI fija versión [topic: runtime/node-floor] review_after: 2027-03-30
- Instalador Node-only: `init.mjs` implementación única, sh/ps1/cmd lanzadores; Node requisito duro [topic: installer/node-only] review_after: 2027-03-30
- `--upgrade` separa memoria PRESERVADA de config REGENERADA y conserva `model:` por agente [topic: installer/upgrade-split] review_after: 2027-03-30
- Backup previo obligatorio antes de escribir en destino no vacío; `--dry-run` no escribe [topic: installer/backup-previo] review_after: 2027-03-30
- Suite propia sin deps (`test/run.mjs`) + CI 5 jobs (3 SO × Node 20/22/24); cero deps runtime [topic: test/ci-gate] review_after: 2027-03-30
- Free tier opencode (`{{MODEL_*}}` sin entitlement) solo se documenta; se valida forma, no entitlement [topic: dx/free-tier-doc] review_after: 2027-03-30
- `lint:sh` resuelve bash (`ADVISOR_BASH`→PATH→Git for Windows); exit 3 sin intérprete; solo raíz (`ROOT_ONLY_EXACT`); en win32 args RELATIVOS porque el PATH puede exponer WSL-bash que destruye rutas `C:\` [topic: tools/lint-sh-crossplatform] review_after: 2027-03-30
- Harness en raíz commiteado (un repo = harness+memoria); excluir de artefacto prod; app en subcarpeta [topic: architecture/harness-placement] review_after: 2027-03-30
- `skill-search.mjs`: registry JSON autoskills (tag `v0.3.6`) best-effort, cache 7d gitignored; tests/doctor sin red [topic: dx/skill-search-registry] review_after: 2027-04-06
- Catálogo autoskills (CC-BY-NC-4.0) nunca commiteado/empaquetado; solo cache local (CLI sin search/list) [topic: dx/autoskills-registry-license] review_after: 2027-04-06
- `/discover` vía `gaps` pura (match exacto deps→registry) + `skill-scaffold.mjs`; sin `/skill-new` [topic: process/discover-gaps] review_after: 2027-04-06
- Estimador `memory-tokens.mjs` (`measure`/`compare`, chars/4, solo lectura; opencode sin usage real) [topic: dx/memory-tokens-estimator] review_after: 2027-04-10
- `init.mjs` resuelve `tar` inline (`ADVISOR_TAR`→System32→PATH, sonda `--version`); sin `tar` exit 3/4 [topic: tools/tar-resolver-crossplatform] review_after: 2027-03-30
- `isMain` con `realpathSync` tolerante a ENOENT (symlinks macOS `/var`); firma intacta, 20 consumidores [topic: runtime/isMain-realpath] review_after: 2027-03-30
- D2: `dev`=integración/`main`=estable (ambas repo completo), promoción `--ff-only`; consumo vía npm + source archive [topic: repo/dev-main-merge] review_after: 2027-01-09
- Publicación npm desde `main` (tag `v*`, guarda ancestría, `NPM_TOKEN`); `latest` apunta a versión buena [topic: release/npm-publish] review_after: 2027-04-18
- Template `templates/gitignore`→`.gitignore` en destino (`TEMPLATE_RENAME`); npm excluye `.gitignore` [topic: installer/tarball-gitignore] review_after: 2027-03-30
- Gate 0 V2 empírico automatizado en `test/e2e-harness-v2.test.mjs` (21 tests instalación→memoria→skills→upgrade contra CLI v2 real): pines `permissions[]` sin pérdida, `subagent_depth` strippado, claves desconocidas sin warnings; reintentos por race del servicio global (`debug agents`/`config`) [topic: test/e2e-v2-empirico] review_after: 2027-01-16
- EOL canónico aplicado AL ESCRIBIR en el destino (`canonicalEol` en init.mjs, espejo del `.gitattributes`: LF puro, CRLF solo `ps1|cmd|bat`); el proyecto instalado recibe su propio `.gitattributes` (TEMPLATE_RENAME) y el instalador fija `core.autocrlf=false` LOCAL en repos fresh; hook post-commit normalizado a LF (no `copyFileSync` ciego); contrato `eol templates` custodia la fuente [topic: installer/eol-canonical] review_after: 2027-01-16

---

## 3. Pendientes inmediatos

- [x] **Gate 0 empírico V2: validado** en `test/e2e-harness-v2.test.mjs` contra CLI 2.0.32 (sin warnings por claves del harness, `default_agent`/`instructions` resueltos, reglas `deny`/`ask` aplicadas). La migración V2-nativa sigue la spec `sdd/v2-compat/spec` (ver SUMMARY, topic `test/e2e-v2-empirico` y `sdd/v2-compat/spec`).
- [ ] Menores no bloqueantes: (a) help de `init.mjs` dice "sin binario global" pero `package.json` expone bins — incoherencia de redacción; (b) `--autoskills 3` no ejecutó autoskills en una prueba (revisar parseo del valor); (c) `release.yml` sin guarda "saltar si `name@version` ya existe" (tag de versión ya publicada fallaría); (d) actualizar/limpiar el stub `0.0.0-stage` si procede; (e) `debug agents` en el REPO DEV (sin `opencode.json` raíz, prohibido instalar el propio harness) no resuelve `builder`/`summarizer` — preexistente y reproducido con control git-stash (los 5 del wiring sí resuelven solo con frontmatter); posiblemente ligado a la migración V2 o al fallback de doctor; revisar si el repo dev debe llevar un `opencode.json` gitignored.

---

## 4. Índice de historial archivado (CAPA 2)

> `CHANGELOG/YYYY-MM-DD.md` — historial semanal archivado (nombrado por lunes).

| Semana (lunes) | Archivo | Resumen |
|----------------|---------|---------|
| 2026-10-12 | 2026-10-12.md | rotación automática |
| 2026-10-05 | 2026-10-05.md | rotación automática |
| 2026-09-28 | 2026-09-28.md | rotación automática |
| 2026-09-21 | 2026-09-21.md | rotación automática |
| 2026-09-07 | 2026-09-07.md | rotación automática |

> Decisiones superadas: `CHANGELOG/DECISIONS-ARCHIVE.md`.

---

## 5. Patrones de código (Code Patterns)

> Memoria de "cómo se hace X aquí" — reutilizable por planner/builder/critic.

| Patrón | Archivo/Ejemplo | Descripción |
|--------|-----------------|-------------|
| memory/search | `node .opencode/scripts/memory-index.mjs search "query"` → `timeline <id>` → `get <id>` | Búsqueda md+grep progresiva, cero dependencias (sin DB) |
| skill/chunk-load | `node .opencode/skills/_skill-loader/loader.mjs chunk "_project-docs" urls,patterns` | Carga solo chunks necesarios para ahorrar tokens |
| test/suite | `npm test` · `npm run test:unit` (`node test/run.mjs`) · `npm run test:contract` · `lint:sh`/`lint:ps1`/`version:check` | Micro-framework sin deps; `test:contract` = anti-drift; `lint-sh.mjs` resuelve bash (exit 3 sin intérprete) |
| shared-lib | `.opencode/scripts/lib/{core,md,cache}.mjs` | Núcleo sin deps (isMain, readText, sectionText, field, fenceSpans, listChangelog, todayUTC, writeAtomic, fingerprint/isFresh, EXIT_CODES): importar, nunca reimplementar |
| installer | `node init.mjs <dir> --upgrade --quick` (exit 0/1/2/3/4/5) | Entrada única; shims delegan; `EXIT_CODES` en `lib/core.mjs`; binarios por env→SO→PATH (`ADVISOR_BASH`/`ADVISOR_TAR`), sonda memoizada |
| installer/eol | `canonicalEol()` en `init.mjs` + `.opencode/scripts/contract-tests.mjs §3a-bis` | Render normaliza EOL al escribir (LF, CRLF en ps1/cmd/bat); `test/eol-canonical.test.mjs` verif. el DESTINO con fixture envenenado; el contrato `eol templates` verif. la FUENTE |
| release/npm | `npm dist-tag add advisor-harness@<v> latest` | Corregir `latest` tras publicar; `publish` desde `main` (tag `v*`) con `NPM_TOKEN` |

---

## 6. Índices de búsqueda

- **Decisiones y patrones**: `PROJECT_STATE.md §2/§5` + `CHANGELOG/DECISIONS-ARCHIVE.md`.
- **Historial y comandos**: `SUMMARY.md` + `CHANGELOG/*.md`; `AGENTS.md` + `CONTRIBUTING.md`.
