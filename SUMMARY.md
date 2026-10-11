# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-11 — CI real en verde: merge FF + fixes de portabilidad (YAML, tar, mapfile) y `isMain` symlink-safe

topic: ci/portability-green
**Goal:** integrar `feat/hardening-refactor-ci` en `main` por fast-forward y conseguir que la CI (5 jobs + `pack-smoke`, 18 combinaciones) corra de verdad en verde — la validación local de Fase 1 no la cubría.
**Discoveries:** la CI nunca había arrancado: `ci.yml` L489 tenía un `name:` sin comillas con `: ` → YAML inválido, GitHub rechazaba el workflow (runs previos `failure` en 0s). El primer run real destapó 2 bugs de portabilidad en `syntax-and-tests`: macOS usaba `mapfile` (bash 3.2 no lo tiene) y Windows usaba el GNU tar de Git, que lee `C:` como host remoto (`Cannot connect to C: resolve failed`). Un tercer run destapó un bug de PRODUCTO: `isMain` no resolvía symlinks; en macOS `/var`→`/private/var` hacía que `main()` no corriera (no-op silenciosa, exit 0, stdout vacío).
**Accomplished:** merge FF de 21 commits (`4eae0fb`); fix YAML `92b2c63` (el push requirió re-auth `gh auth refresh -s workflow`); fix portabilidad `4854a4d` — `init.mjs` resuelve el `tar` internamente (opción robusta espejando `lint-sh.mjs`; el critic detectó que el propio test usaba `tar` con rutas `C:\`); fix `isMain` `37fd72b` — canonicaliza ambos lados con `realpathSync` tolerando ENOENT (helpers `realpathOr`/`canonicalKey`), espejo byte-idéntico en `templates/` + test de regresión con symlink. 2 decisiones nuevas en §2.
**Next:** nada inmediato bloqueante; pendiente menor nuevo: que `contract-tests.mjs` respete `.opencode/.gitignore`. Candidato siguiente: publicar release.
**Files:** `git log --oneline -5` (detalle en git, no aquí).
**Verificación:** PASS — CI run 38120377887 = **18/18 success** en `main` @ `37fd72b`; local: `node test/init.test.mjs` 29/29, `node test/lib.test.mjs` 84/84, `lint:sh` 0, `version:check` 0, `npm test` exit 0 en copia limpia (los 2 fallos locales son ambientales).

## 2026-10-11 — spec: ci-portability-fix (portabilidad macOS/Windows de `syntax-and-tests`)

topic: sdd/ci-portability-fix/spec
**Goal:** conservar la spec-lite que guió el fix de portabilidad de la CI (criterios MUST verificables) para que el build quede auditable (spec no persistida en su momento; reconstruida tras implementar).
**MUST (RFC2119):**
- MUST-1 macOS/bash 3.2: Given `syntax-and-tests` en macOS When corre el job Then no usa `mapfile` (no existe en bash 3.2) y el job pasa en verde.
- MUST-2 Windows/tar: Given el instalador en Windows When empaqueta/extrae Then `tar` no interpreta `C:` como host remoto; se resuelve el binario con orden `ADVISOR_TAR` → `%SystemRoot%\System32\tar.exe` → PATH (espejando `lint-sh.mjs`), sin extraer a `lib/`.
- MUST-3 no-vacuidad del test: Given el test del resolutor When valida rutas `C:\` Then el propio test no usa `tar` de forma que enmascare el bug (hallazgo del critic).
**SHOULD:**
- SHOULD-1 sonda `--version` memoizada como detección de existencia; sin `tar` = exit 3 (preflight) / 4 (backup).
**Veredicto critic:** APROBADO CON CAMBIOS (detectó el uso de `tar` en el propio test); implementado y verificado en verde.

## 2026-10-10 — Estimador estático del ahorro potencial en tokens (advisor+memoria vs plan+build)

topic: dx/memory-tokens-estimator
review_after: 2027-04-10
**Goal:** calcular de forma determinista y sin dependencias el ahorro potencial en tokens del harness advisor con memoria frente a un flujo plan+build sin memoria.
**Discoveries:** no existe contador real de tokens por sesión/tarea (opencode no expone usage por tarea), así que el estimador es estático, de solo lectura y por heurística `TOKENS_PER_CHAR=4`. Hallazgo del test: con contexto diminuto el ahorro sale NEGATIVO (el coste fijo del advisor supera al baseline); la memoria solo compensa con contexto no trivial, así que se usó un fixture de tamaño realista.
**Accomplished:** nuevo `.opencode/scripts/memory-tokens.mjs` (ESM sin deps; reusa lib/core.mjs, lib/md.mjs y memory-stats.entriesRegion) con `measure [--json] [--root]` (tokens por capa: PROJECT_STATE/SUMMARY/CHANGELOG/skills+chunks) y `compare --scenario direct|delegated|spec-lite [--json]` (baseline=(1+hojas)*C_full+rework vs advisor=state+k*400+hojas*120+chunks*150(+867 spec-lite)); espejo byte-idéntico en `templates/`. Check ℹ️ `tokens` + `script memory-tokens.mjs` ✅ añadido a ambas copias de `doctor.mjs` (misma severidad, nunca degradan exit); nuevo `test/memory-tokens.test.mjs` (13 casos, fixtures en tmpdir); docs en AGENTS.md, `_project-docs/SKILL.md`, `commands/doctor.md` y README (sección `### Estimador de tokens (memory-tokens.mjs)`). Resultados sobre este repo: direct ~87.6%, delegated ~95%, spec-lite ~94.5%.
**Next:** commit + push de la rama `feat/hardening-refactor-ci` (pendiente); opcional futuro: instrumentación por rutina para medir ahorro REAL (no potencial).
**Files:** `git log --oneline -5` (detalle en git, no aquí).
**Verificación:** PASS — `npm test` exit 0 (14/14 archivos, rotación 48/48, contrato ✅ 43 espejos/33 scripts, versión 2.0.0); `doctor --json` exit 0 (check `tokens` ℹ️, `script memory-tokens.mjs` ✅); `memory-tokens compare --scenario spec-lite --json` exit 0 → savingPct 94.5.

## 2026-10-06 — `/discover` con búsqueda real de skills instalables + sugerencia de skills de proyecto

topic: dx/skill-search-registry
review_after: 2027-04-06
**Goal:** que `/discover` deje de simular el mapeo de skills: buscar de verdad en el registry de autoskills las skills instalables que faltan y proponer, para cada gap, una skill de proyecto scaffoldable; todo sin volver la red un requisito de runtime.
**Discoveries:** el CLI de autoskills no expone `search`/`list`/`--json`, así que la única vía es el registry JSON público (pineado al tag `v0.3.6`); su licencia CC-BY-NC-4.0 impide commitear/empaquetar el catálogo (solo cache local gitignored). El harness no tenía ninguna dependencia de red en runtime: se acotó a best-effort/offline para no romper `npm test`/`doctor`/`/discover`. El match de gaps es determinista (exacto normalizado deps→registry), no heurístico.
**Accomplished:** nuevo `skill-search.mjs` (fetch best-effort del registry, cache `.advisor/autoskills-registry.cache.json` TTL 7d gitignored, flags `--json`/`--offline`/`--refresh`/`--limit`, ranking, fallback a cache stale o salida vacía + exit 0, y función pura `gaps`) y nuevo `skill-scaffold.mjs` (dry-run por stdout, `--write` atómico, `--force`) que genera `.opencode/skills/<name>/SKILL.md` válido para `loader.mjs`. `/discover` paso 3 ejecuta búsqueda real y emite tabla de gaps + comando scaffold listo para `/routine` (sin comando `/skill-new`: se reusa `/routine`→builder). `planner.md` gana allow bash acotado a `skill-search.mjs` por flag. 3 decisiones nuevas en §2.
**Next:** commit propuesto (no ejecutado); el único pendiente real sigue siendo integrar `feat/hardening-refactor-ci` en `main` y ver la CI real.
**Files:** `git log --oneline -5` (detalle en git, no aquí).
**Verificación:** PASS — `npm test` exit 0 (13/13 archivos, contrato ✅, versión 2.0.0 en 5 ficheros); `npm run test:contract` ✅ (42 espejos, 31 scripts `node --check`); `lint:sh`/`lint:ps1` ✅; `doctor --json` exit 0 (0❌/0⚠️/3ℹ️); espejo SHA256 idéntico en `discover.md`/`planner.md`/`skill-search.mjs`/`skill-scaffold.mjs`; tests sin red (fixture sintético, sin `fetch`).

## 2026-10-06 — spec: discover-real-skills (búsqueda real + scaffold de skills)

topic: sdd/discover-real-skills/spec
review_after: 2027-04-06
**Goal:** conservar la spec-lite que guió la implementación (criterios MUST verificables) para que el build sea auditable.
**MUST (RFC2119):**
- MUST-1 búsqueda real: Given `/discover` paso 3 When hay red Then consulta el registry público de autoskills y muestra resultados rankeados; When no hay red Then degrada a cache local (aunque stale) o salida vacía + exit 0, sin fallar.
- MUST-2 CI sin red: Given `npm test`/`doctor`/`/discover` When corren sin red Then pasan en verde (tests con fixture sintético, sin `fetch`).
- MUST-3 gaps determinista: Given deps del proyecto y registry When se calculan gaps Then el match es exacto normalizado y determinista (misma entrada → misma salida).
- MUST-4 scaffold válido: Given `skill-scaffold.mjs <name> --description ".."` When dry-run Then imprime el `SKILL.md` por stdout sin escribir; When `--write` Then escribe atómico en `.opencode/skills/<name>/SKILL.md` y `loader.mjs` lo reconoce.
- MUST-5 licencia: Given el catálogo CC-BY-NC-4.0 When se instala/empaqueta Then nunca se commitea ni empaqueta; solo cache local gitignored.
**SHOULD:**
- SHOULD-1 `--json`/`--offline`/`--refresh`/`--limit` y fallback offline en `skill-search.mjs`.
- SHOULD-2 `/discover` emite tabla de gaps y propone comando scaffold listo para `/routine`, sin comando `/skill-new`.
**Veredicto critic:** APROBADO (implementación verificada en verde).

<!-- ADVISOR:ENTRIES:END -->

> Cuando registres progreso (via `/record` o `summarizer`), añade entradas al inicio, tras este bloque (formato 2.0 con topic + 6 campos, compat viejo `Qué/Verificación`):

```markdown
## YYYY-MM-DD — <Título corto>

topic: <family/kebab>  <!-- ej architecture/auth, sdd/login/spec -->
**Goal:** <objetivo>
**Discoveries:** <hallazgos>
**Accomplished:** <qué se hizo y decisiones>
**Next:** <siguientes pasos>
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** <comandos y resultado>
```

> Topic upsert: mismo `topic:` en 7d → actualiza no duplicar. No agregues listas archivos (usa `git log`). Rotación canónica en `/record` vía motor Node (`memory-rotate.mjs`); hook post-commit opcional/gated (`ADVISOR_ROTATE_HOOK=1`); `/rotate-memory` como disparo manual. Búsqueda: `node .opencode/scripts/memory-index.mjs search "query"`.

---

## Índice de historial archivado (CAPA 2)

| Semana (lunes) | Archivo |
|----------------|---------|
| (aún sin historial) | — |
