# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-18 — Wiring comando→agente→capacidad (P0/P1) + higiene CLI (P2) ✓

topic: agents/wiring-permissions
**Goal:** cerrar los 3 wiring rotos detectados en el audit (/doctor→explore, /routine→advisor, /discover→planner pedían bash que los agentes tenían denegado) y la higiene CLI de 3 scripts (`--help` exit 0, error de uso exit 1 en una línea sin stack, éxito falso eliminado).
**Discoveries:** resolver el wiring requiere espejo en DOS sitios: los permisos viven en frontmatter y en `templates/opencode.json` (regla del repo: consistencia frontmatter↔opencode.json, "enforcement real = opencode.json"); el CLI v2 resuelve y normaliza los mapas de ambos (e2e 21/21 lo pina). Además, 4 repros de éxito falso: `routine-model --help`/sin-args → exit 0 SILENCIO (había test pineado del comportamiento viejo — se actualizó deliberadamente); `memory-stats monday <inválida>` soltaba TypeError con stack; `memory-tokens compare --scenario <inválida>` igual; `memory-stats lines <ruta explícita inexistente>` → exit 0 como "count 0" (un typo haría pasar los límites de memoria).
**Accomplished:** (1) explore: `bash: deny` → `"*": deny` + allowlist READ-ONLY (doctor/memory-index/stats/tokens, `memory-lock status`, `loader list|search|chunk`; FUERA rotate/sync/lock acquire-release/loader refresh); (2) advisor: `"*": deny` + UNA excepción `routine-model.mjs*` (resolución de `--model-*`); (3) planner: + `loader.mjs list|search|chunk` junto a skill-search (discover.md reatribuye el conteo al retorno de planner); (4) los 3 espejados en `templates/opencode.json` (`agent.<name>.permission.bash`); (5) P2: los 3 scripts con `--help/-h` exit 0, uso por stdout, `fail()` una línea sin stack (exit 1), flags/args desconocidos ya no se tragan en silencio; (6) AGENT-PIPELINE.md con la nota de wiring; (7) pines e2e nuevos (allow puntuales + loop de normalización extendido a los 3 agentes) y suites CLI nuevas en los 3 tests.
**Next:** fase 2 anotada: `general` `task` de `ask`→`deny`; contrato "wiring comando→scripts→executor" en contract-tests; encaje con la migración V2 a `permissions[]` en opencode.json.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `node test/e2e-harness-v2.test.mjs` 21/21 contra CLI v2 real (normalización advisor/planner/explore + allows llegan a la config resuelta); `contract-tests.mjs` PASS (espejo 41 + eol 44 + node --check 33); `npm test` "harness ok" 16/16 / 48 passed; `lint:sh`/`lint:ps1` exit 0; repros manuales: `--help`→0, desconocido→1 con una línea, `monday zz`→1 sin stack, `lines <inexistente>`→1, `lines` default→0 (tolerante, pin del conservado).

## 2026-10-18 — EOL canónico al instalar (.gitattributes + render normalizado) ✓

topic: installer/eol-canonical
**Goal:** eliminar las 40+ warnings "LF will be replaced by CRLF" del commit inicial del instalador y, sobre todo, blindar los `.sh` (hook post-commit, check-memory-limits) contra conversiones CRLF de git que rompen bash (`\r: command not found`).
**Discoveries:** la regla existía declarada en `.gitattributes` de la raíz pero NO se aplicaba al escribir: `renderFile` volcaba tal cual (un template CRLF del working tree aterrizaba crudo en el destino) e `installGitHook` usaba `copyFileSync` byte-exacto. El catch-all de `renderTree` dejaba fuera `gitignore`/`.gitattributes`/`.cmd`/`.bat` (sin extensión o ext no listada). Diagnóstico verificado empíricamente: solo los `.ps1` tenían CRLF en disco (canónico ya); el resto del arbol estaba limpio — el riesgo era el working tree de OTRO contribuidor, no este.
**Accomplished:** (1) `canonicalEol()` en `init.mjs` (espejo literal del `.gitattributes`: todo→LF, `ps1|cmd|bat`→CRLF), aplicado en `renderFile`; (2) `installGitHook` normaliza a LF al instalar; (3) `renderTree` rutea por render todo lo textual + los 2 renombres; (4) nueva plantilla `templates/gitattributes` (TEMPLATE_RENAME) que declara la convención en CADA proyecto instalado; (5) `gitInitAndCommit` fija `core.autocrlf=false` LOCAL en repos fresh (best-effort, nunca global); (6) contrato nuevo `eol templates` (44 ficheros) en contract-tests; (7) test nuevo `test/eol-canonical.test.mjs` (3 tests, fixture envenenado con CRLF/LF mixto); (8) `.gitattributes` en catálogos de init.mjs (BACKUP_ITEMS/REGENERATED/PART_HARNESS/uninstallPlan), `TEMPLATE_ONLY_EXACT` y listas de init.test/e2e.
**Next:** decision anunciada cuando toque release (es fix interno de 1.0.1 publicada; bump si sale por npm); migración V2 sigue en marcha según spec.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `test/eol-canonical.test.mjs` 3/3 (árbol envenenado instala LF puro, commit inicial SIN "LF will be replaced", hook LF en `.git/hooks/`); `node .opencode/scripts/contract-tests.mjs` PASS (nuevo `eol templates — 44`); `npm test` PASS 16/16 archivos + "harness ok"; `npm pack --dry-run` → `templates/gitattributes` viaja (420B); reinstalación empírica en `../prueba1`: cero warnings, `core.autocrlf=false` local, `ls-files --eol` pinta `w/lf`+`attr/eol=lf` (`.ps1` → `w/crlf`), hook con 0 bytes CR, doctor del proyecto instalado en verde; `lint:ps1` exit 0.

<!-- ADVISOR:ENTRIES:END -->

> Cuando registres progreso (via `/record` o `summarizer`), añade entradas al inicio, tras este bloque (formato 1.0 con topic + 6 campos, compat viejo `Qué/Verificación`):

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
