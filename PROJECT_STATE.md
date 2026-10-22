# PROJECT_STATE — consigliere (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Este archivo es la ÚNICA fuente que los agentes deben leer obligatoriamente al iniciar una sesión. `SUMMARY.md` (última semana) y `CHANGELOG/` (historial archivado) se leen **solo on-demand** cuando la tarea requiere contexto histórico. Estructura/detalle técnico completo: `AGENTS.md` y `.opencode/plans/`.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fases 0/0.5/1 + modelo D2 + release 1.0 | Bootstrap/hardening/validación demo; `dev` = integración / `main` = estable (ambas repo completo, promoción `--ff-only`); `advisor-harness@1.0.1` en npm, contrato git-aware, `lint:sh`/PATH resuelto | ✅ Completadas |
| Release 1.0.2 | `advisor-harness@1.0.2` publicada (2026-10-21): npm `latest` = 1.0.2 vía Trusted Publishing OIDC desde `release.yml` (tag `v1.0.2` → `6c5431e`), provenance SLSA v1, GitHub Release con el tarball oficial de npm; smoke test del paquete publicado OK; token granular revocado y 0 secrets npm en el repo | ✅ Publicada |

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Harness-only sin app server: Node >=20.11 ESM + Bash/PowerShell + git/tar; scaffolding vía init.mjs/sh/ps1 [topic: architecture/harness-scope] review_after: 2026-12-03
- Memoria 3 capas md+grep (STATE/SUMMARY/CHANGELOG) con fingerprint path+mtime+size; sin DB ni SQLite [topic: architecture/stack-md-grep] review_after: 2026-12-03
- Skill loader con cache fingerprint `.advisor/skill-registry.cache.json` y chunks bajo demanda [topic: dx/skill-loader-cache] review_after: 2026-12-03
- Sunset legacy: solo `.advisor/` vivo, fallback read-only `.consigliere/` eliminado de instaladores/scripts y `.gitignore` (F6) [topic: repo/legacy-sunset] review_after: 2026-12-03
- Advisor-only routing orgánico + SDD-lite ≤650w [topic: sdd/routing-organico] review_after: 2026-12-21
- Lock `memory-lock.mjs` (mkdir atómico + owner.json/token, takeover por rename, stale `ADVISOR_LOCK_STALE_MS`; sin `flock`) y rotación canónica: `mondayOf` UTC único (memory-sync importa de memory-stats) + marcadores `ADVISOR:ENTRIES` y motor `memory-rotate.mjs` en `/record`, hook post-commit gated [topics: memory/lock-canonico, memory/markers-motor] review_after: 2026-12-21
- Routing por clase de riesgo (conteo = desempate); advisor delega deltas; spec-lite persistida y consumida por builder [topic: process/routing-risk-deltas] review_after: 2026-12-21
- Contract tests en `npm test` (paridad raíz↔templates con allowlist; `ls-files` respeta `.gitignore`, incl. test/contract-git-aware) [topic: test/contracts-antidrift] review_after: 2026-12-21
- Runtime real Node >=20.11: `import.meta.dirname` en 15 scripts + `isMain` con `realpathSync` tolerante a ENOENT (symlinks macOS `/var`, firma intacta, 20 consumidores); `engines: >=18` mentía, CI fija versión [topics: runtime/node-floor, runtime/isMain-realpath] review_after: 2027-03-30
- Instalador Node-only: `init.mjs` implementación única, sh/ps1/cmd lanzadores; Node requisito duro [topic: installer/node-only] review_after: 2027-03-30
- `--upgrade` separa memoria PRESERVADA de config REGENERADA (conserva `model:` por agente) y exige backup previo si el destino tiene contenido; `--dry-run` no escribe [topic: installer/upgrade-backup] review_after: 2027-03-30
- Suite propia sin deps (`test/run.mjs`) + CI 5 jobs (3 SO × Node 20/22/24); cero deps runtime [topic: test/ci-gate] review_after: 2027-03-30
- Free tier opencode (`{{MODEL_*}}` sin entitlement) solo se documenta; se valida forma, no entitlement [topic: dx/free-tier-doc] review_after: 2027-03-30
- Resolver binarios crossplatform único patrón: `lint:sh` resuelve bash (`ADVISOR_BASH`→PATH→Git for Windows, exit 3 sin intérprete, solo raíz `ROOT_ONLY_EXACT`, args RELATIVOS en win32 porque el PATH puede exponer WSL-bash que destruye rutas `C:\`) y `init.mjs` resuelve `tar` inline (`ADVISOR_TAR`→System32→PATH, sonda `--version`; sin tar exit 3/4) [topics: tools/lint-sh-crossplatform, tools/tar-resolver-crossplatform] review_after: 2027-03-30
- Harness en raíz commiteado (un repo = harness+memoria); excluir de artefacto prod; app en subcarpeta [topic: architecture/harness-placement] review_after: 2027-03-30
- `skill-search.mjs`: registry JSON autoskills (tag `v0.3.6`) best-effort, cache 7d gitignored, tests/doctor sin red; catálogo (CC-BY-NC-4.0) nunca commiteado/empaquetado, solo cache local (CLI sin search/list) [topics: dx/skill-search-registry, dx/autoskills-registry-license] review_after: 2027-04-06
- `/discover` vía `gaps` pura (match exacto deps→registry) + `skill-scaffold.mjs`; sin `/skill-new` [topic: process/discover-gaps] review_after: 2027-04-06
- Estimador `memory-tokens.mjs` (`measure`/`compare`, chars/4, solo lectura; opencode sin usage real) [topic: dx/memory-tokens-estimator] review_after: 2027-04-10
- D2: `dev`=integración/`main`=estable (ambas repo completo), promoción `--ff-only`; consumo vía npm + source archive [topic: repo/dev-main-merge] review_after: 2027-01-09
- Publicación npm desde `main` (tag `v*`, guarda ancestría, **Trusted Publishing OIDC** sin tokens: el Trusted Publisher de npmjs.com DEBE tener "Allow npm publish" marcado (si no, `E403 OIDC permission denied`), Publishing access "disallow tokens", npm >=11.5.1 en publish, `setup-node` sin `registry-url` (setup-node#1551)); skip-if-published (`npm view`, skip solo en `E404`), GitHub Release idempotente y aserción post-publish de `dist-tags.latest`; `latest` apunta a versión buena [topic: release/npm-publish] review_after: 2027-04-18
- Template `templates/gitignore`→`.gitignore` en destino (`TEMPLATE_RENAME`); npm excluye `.gitignore` [topic: installer/tarball-gitignore] review_after: 2027-03-30
- Gate 0 V2 empírico automatizado en `test/e2e-harness-v2.test.mjs` (21 tests instalación→memoria→skills→upgrade contra CLI v2 real): pines `permissions[]` sin pérdida, `subagent_depth` strippado, claves desconocidas sin warnings; reintentos por race del servicio global (`debug agents`/`config`) [topic: test/e2e-v2-empirico] review_after: 2027-01-16
- EOL canónico aplicado AL ESCRIBIR en el destino (`canonicalEol` en init.mjs, espejo del `.gitattributes`: LF puro, CRLF solo `ps1|cmd|bat`); el proyecto instalado recibe su propio `.gitattributes` (TEMPLATE_RENAME) y el instalador fija `core.autocrlf=false` LOCAL en repos fresh; hook post-commit normalizado a LF (no `copyFileSync` ciego); contrato `eol templates` custodia la fuente [topic: installer/eol-canonical] review_after: 2027-01-16
- Config dev del repo gitignored generada por `dev-config.mjs` (`npm run dev:config`): `templates/opencode.json` con `{{MODEL_*}}`→`""`, `--check`/`--force` y no-op si existe; `doctor` SIN fallback a `templates/` (config raíz = prerequisito duro, CI la invoca igual) [topic: dx/dev-config-gitignored] review_after: 2027-04-18
- Frontmatter de agentes con escalares YAML de comillas dobles válidos (`C:\\*`): `\*` NO es escape válido y hacía que opencode no parseara `builder`/`summarizer` (paridad byte a byte raíz↔templates en las 4 copias) [topic: agents/frontmatter-yaml-escape] review_after: 2027-04-18
- Versión con fuente única: `package.json` manda y `npm run version:bump <patch|minor|major>` reescribe los 5 destinos que vigila `version-check` (raw EOL + rollback); `version-check` es módulo puro importable (`isMain`, cero side effects) y ambos scripts son dev-only (`ROOT_ONLY_EXACT`) [topic: release/version-bump-single-source] review_after: 2027-04-21
- Workflows reusables: `github.workflow` se resuelve al nombre del CALLER — grupos de concurrencia con prefijo literal distinto por workflow (`ci-${{ github.ref }}`/`release-${{ github.ref }}`) y `cancel-in-progress` diferenciado (CI sí — read-only/re-ejecutable; release no — nunca cortar un publish); incidente run 39629128099: `ci.yml` vía `workflow_call` heredaba "Release" y caller/callee se auto-bloqueaban en el mismo grupo (1 s) [topic: ci/reusable-concurrency-literal-groups] review_after: 2027-04-21
- `/skill-capture` consolida memoria en skills reales: `skill-capture.mjs` (§2+§5+SUMMARY/CHANGELOG por topic → SKILL.md con contenido; fail-closed "≥1 fuente" de {§2,§5,entradas} — §3 pendientes NO rescatan; dry-run por defecto/`--write`/`--force`; parser acepta `[topic:]` y `[topics:]` plural; match exacto o prefijo de categoría, dedup por slugId; cap `--summary N` por sección de origen; nombres `_` reservados; `skill-scaffold` queda esqueleto puro y `/discover` intacto). **Captura "reusable tal cual":** los chunks sin contenido se filtran (cero placeholders, ni en frontmatter ni en cuerpo), las entradas SUMMARY/CHANGELOG se emiten con texto íntegro vía lectores exportados (`entriesRegion` de memory-stats, `parseRegion`/`headingToId` de memory-rotate — `memory-index.mjs` intacto) y `renderCapture` devuelve null si no queda ningún chunk ⇒ exit de uso; reuso conductual validado en A/B ciego (con skill: forma canónica `"C:\\algo\\*": allow` + cita textual de la regla; control: comillas simples no validadas). **Metadatos fuera del cuerpo:** `stripMeta()` elimina `[topic:]/[topics:]` y `review_after: YYYY-MM-DD` del texto renderizado (decisiones/patrones/entradas/pendientes) con guard de code spans — la sintaxis citada entre backticks no se mutila. **Supersede parcial** de process/discover-gaps: SOLO la cláusula "sin `/skill-new`" queda revocada — `/skill-capture` es el skill-new canónico desde memoria; gaps puros + `skill-scaffold` siguen vigentes [topic: process/skill-capture] review_after: 2027-10-22
- ADVISOR-AGILITY: Fase 0 (telemetría) y fix `--autoskills` implementados en ramas borradas SIN integrar (2026-10-22) — solo queda el diagnóstico en SUMMARY, el trabajo hay que rehacerlo; 80/20: permisos y topes [topic: architecture/advisor-agility] review_after: 2027-01-20

---

## 3. Pendientes inmediatos

- [x] Fase 2: feat `/skill-capture` (memoria→skills reales) — **cerrado (2026-10-22):** implementado y VERDE (planner + critic; `npm test` 21/21, contract 43 espejos, doctor 0); supersede parcial de "sin `/skill-new`" en §2 `process/skill-capture`; el menor del `stripMeta()` (metadatos fuera del cuerpo, guard de code spans, 26/26) también cerrado.
- [ ] **Fase 0 ADVISOR-AGILITY (telemetría obligatoria al cierre) — reabierta (2026-10-22):** el commit `e03f241` y el plan `.opencode/plans/ADVISOR-AGILITY.md` quedaron SOLO en el reflog (`7d1ffa7`), ramas borradas sin integrar ⇒ el plan vuelve a estado **"sin implementar"** (recuperar el contenido con `git branch feat/advisor-agility 7d1ffa7`); al rehacerlo, 80/20: permisos y topes antes que más telemetría [topic: architecture/advisor-agility].
- [ ] `release.yml` (no bloqueantes, de la 1.0.2): (a) "verificar en el registry" sin reintentos/espera — corrió 3 s tras el publish y dio E404 (npm tarda ~2-3 min; run 39656624120 en rojo con todo publicado); (b) ese paso está gateado por `steps.published.outputs.ya != 'true'` y se salta en reruns con la versión ya publicada → quitar la condición; (c) colas largas de runners macOS arm64 cancelan el gate → valorar `timeout`/`continue-on-error`/reintento sin perder cobertura. · Menores no bloqueantes: (a) help de `init.mjs` dice "sin binario global" pero `package.json` expone bins — incoherencia de redacción; (b) **`--autoskills` reabierto (2026-10-22):** el flag es un **selector** `1|2|3` (nunca una cantidad; `3` omite por diseño, parsea bien), y los defectos reales siguen VIVOS en `dev` — el aviso de omisión es código muerto por el gate `autoChoice !== '3'` (`init.mjs:1149`), los modos 1/2 no tienen tests y el `warn` ante fallo de `npx` es genérico; el arreglo (`a2ef759`, `fakeNpx()` + 5 casos) se descartó con la rama ⇒ hay que rehacerlo · **(c)(d)(e) cerrados:** skip-if-published en `release.yml` (2026-10-21, §2 `release/npm-publish`); `0.0.0-stage` sin artefacto vivo (2026-10-21); escape YAML inválido del frontmatter de agentes (2026-10-18, §2 `agents/frontmatter-yaml-escape`).

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
| installer/autoskills | `init.mjs --autoskills <1\|2\|3>` (selector, NO cantidad) | Para testear los modos 1/2 sin red: inyectar un `npx` falso en `PATH` (técnica válida, hoy no implementada — el `fakeNpx()` de `a2ef759` se perdió con la rama); modo 3 omite por diseño |
| release | `npm dist-tag add advisor-harness@<v> latest` · `npm run version:bump patch` (`--dry-run`/`--set X.Y.Z`) | Corregir `latest` tras publicar; bump de fuente única que hereda los 5 `TARGETS` de `version-check.mjs` y escribe in-place con EOL crudo (`bump()` = core puro importable) |
| dev-config | `npm run dev:config` (`.opencode/scripts/dev-config.mjs`, root-only) | Genera la `opencode.json` dev gitignored desde `templates/opencode.json` (`{{MODEL_*}}`→`""`); `--check`/`--force`; no-op si existe. Prerequisito de `npm test` en clon limpio · **orden**: `dev:config` ANTES de `routine-model --persist` (si no, `--persist` edita `.opencode/opencode.json`, que NO está ignorado) |
| test/wiring | `test/wiring-basic.test.mjs` (4 suites / 18 asserts) | Wiring estático comando→agente→script SIN CLI: paridad semántica frontmatter↔`templates/opencode.json`, invariante repo-dev con `opencode.json` raíz presente (7 agentes, cero `{{`, `--check` de frescura), ciclo memoria en tmpdir; complementa e2e-v2, contract-tests y dev-config.test.mjs |
| test/tmpdir | `tmpdir()` en `test/harness.mjs` (canonicaliza con `realpathSync`) | Devuelve la ruta YA canonicalizada: obligatorio comparar rutas con helpers de la suite, nunca `os.tmpdir()` crudo (macOS: `/var` → `/private/var`); custodia `test/harness-paths.test.mjs` (junction win32 sin admin) |
| agents/task-perms | `.opencode/agents/advisor.md` `permission.task` (+ espejo `templates/.opencode/agents/advisor.md`) | Los permisos de `task` viven SOLO en el frontmatter de advisor.md (`general: deny` corta al built-in `general` de opencode, fuera del pipeline de 7); `templates/opencode.json` NO los contiene |
| skill/consolidar | `node .opencode/scripts/skill-capture.mjs <topic> [--write]` | Consolida decisión §2 + patrón §5 + entradas SUMMARY/CHANGELOG por topic en skill real con contenido; scaffolding en `/discover` (skill-scaffold puro) |

---

## 6. Índices de búsqueda

- **Decisiones y patrones**: `PROJECT_STATE.md §2/§5` + `CHANGELOG/DECISIONS-ARCHIVE.md` · **Historial y comandos**: `SUMMARY.md` + `CHANGELOG/*.md`; `AGENTS.md` + `CONTRIBUTING.md`.
