# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-09-30 — `lint:sh` cross-platform: el script npm resuelve el intérprete de bash

topic: tools/lint-sh-crossplatform
review_after: 2027-03-30
**Goal:** cerrar el pendiente de PATH de `lint:sh` en Windows — el warning ambiental que dejó la Fase 1 no era un problema de entorno tolerable: era un `bash -n` a pelo que moría en cmd.exe aunque el repo estuviera bien.
**Discoveries:** el bash de Git for Windows vive fuera del PATH de cmd.exe, así que el fallo era ENOENT y no de sintaxis — indistinguible de un `.sh` roto para quien lee el log; y no existía mapa de exit codes: el script npm heredaba el de `bash -n` sin forma de decir "no hay intérprete" (0 ok / 1-2 de bash / 3 sin bash). La CI era el espejo del mismo punto ciego: su bucle `bash -n` solo pasaba porque el runner trae bash en el PATH, así que ni la resolución ni el mapeo de exit codes se ejecutaban en ninguna plataforma. Y al no llevar espejo en `templates/`, el anti-drift exige catalogar el fichero nuevo como `ROOT_ONLY_EXACT` (precedente: `contract-tests.mjs` / `version-check.mjs` / `memory-rotate.test.mjs`).
**Accomplished:** `lint:sh` pasa a ser un script Node ESM sin deps que resuelve el intérprete en orden `ADVISOR_BASH` → `bash` del PATH → rutas de Git for Windows (solo win32) y sale con exit 3 + mensaje accionable si no aparece ninguno; un override explícito es una orden, no cae al siguiente candidato en silencio. En linux/macos el PATH gana siempre, así que no hay divergencia cross-platform ni cambio de comportamiento respecto a antes. El fichero queda solo en raíz, catalogado en `ROOT_ONLY_EXACT` como "presente solo en raíz a propósito": es tool de dev del repo, no del harness instalado. La CI ejecuta `npm run lint:sh` antes del bucle `bash -n` existente, que sigue cubriendo los 5 `.sh` (no lo sustituye). Decisión durable registrada en §2.
**Next:** integrar la rama en `main` y dejar correr la CI real de 5 jobs + `pack-smoke`, que sigue siendo lo único sin verificar. Queda un menor knowingly NO arreglado (anotado en §3): `bash scripts/check-memory-limits.sh` en Development commands y los bloques de comandos de `_project-docs/SKILL.md` siguen invocando `bash` a pelo y no funcionan sin bash en el PATH — son comandos para copiar/pegar, no scripts npm, y el paso por el resolutor no aplica.
**Files:** `git status --porcelain` + `git diff` (el detalle de ficheros está en git, no aquí).
**Verificación:** PASS — `npm run lint:sh` exit 0 resolviendo `C:\Program Files\Git\bin\bash.exe`; bajo Git Bash simulando el runner de CI también 0; `npm run test:contract` exit 0 (16 checks, +1 por la entrada nueva de `ROOT_ONLY_EXACT`); `doctor --json` exit 0 sin warnings nuevos; `npm test` exit 0 (suite 11/11, rotación 48/48, contrato, `version:check` 2.0.0); ruta negativa con `ADVISOR_BASH` a un path inexistente → exit 3 con el mensaje de arreglo. NO verificado: la CI real en los runners de GitHub Actions.

## 2026-09-30 — Fase 1 completada: validación real en proyecto demo + cierre de la rama

topic: validation/fase-1-demo
review_after: 2027-03-30
**Goal:** Ejecutar la Fase 1 pendiente (validar el harness ya instalado en un proyecto demo: `init.mjs`, `--upgrade`, `doctor`) y registrar el veredicto de la verificación completa de la rama `feat/hardening-refactor-ci`.
**Discoveries:** `--upgrade` sobre destino ya instalado fue un éxito REAL, no un falso: backup `.tgz` de 11 ítems, logs de preservación y el hook existente NO se sobrescribe (se copia a `.advisor/backups/hooks/`); la prueba dura de no-sobrescritura de la memoria del usuario fue un sentinel inyectado en `PROJECT_STATE.md` y `SUMMARY.md` con sha256 IDÉNTICOS antes/después. En el proyecto instalado, `doctor` da 0❌/0⚠️ (5 ℹ️ esperados de recién instalado). Único warning de la sesión: `npm run lint:sh` no es ejecutable en esta máquina porque `bash` no está en el PATH de cmd.exe (existe en `C:\Program Files\Git\bin\bash.exe`); no es defecto de la rama — re-ejecutado con ruta absoluta, `bash -n` sobre `init.sh` y `scripts/check-memory-limits.sh` da OK. Nota menor: la instalación corre `npx autoskills`, que en el demo deja `skills-lock.json` modificado y `.agents/` untracked tras el commit inicial (cosmético).
**Accomplished:** Fase 1 cerrada (era el pendiente principal). §2 confirmada sin duplicar: runtime/node-floor, installer/node-only, installer/upgrade-split, installer/backup-previo, test/ci-gate y shared-lib ya estaban. Compactada: `repo/legacy-ignore` sale de §2 a `CHANGELOG/DECISIONS-ARCHIVE.md` — superada por el sunset F6 (la copia anidada ya no existe y su regla de ignore salió de `.gitignore`); ese archivo estaba referenciado desde §4/§6 y no existía, así que la referencia colgada pasa a ser real. Pendientes nuevos en §3: CI real en el push y requisito de PATH de bash en Windows.
**Next:** integrar la rama en `main` con la CI de 5 jobs + `pack-smoke` corriendo de verdad (lo único que la validación local no cubre) y documentar `lint:sh` como requisito de PATH; `DEP0190` (`shell:true` en `init.mjs`) solo se mira si deja de ser preexistente. Revisar §2 en review_after.
**Files:** `git log --oneline main..HEAD` (14 commits de `feat/hardening-refactor-ci`; el detalle está en git, no aquí).
**Verificación:** PASS con un warning ambiental — `node --check` 40/40 `.mjs`; `npm test` exit 0 (suite 11/11 ficheros, rotación 48/48, contrato 15/15, `version:check` 2.0.0); `test:unit` 11/11; `test:contract` OK (paridad 40 archivos); `lint:ps1` OK; `version:check` 2.0.0 consistente en 5 ficheros; `check-memory-limits.sh` 81/100 y 56/150; `doctor --json` 19/19 con 0 warnings y 0 errors; `git status --porcelain` limpio. NO verificado: CI (5 jobs) y `pack-smoke` (requieren red/GitHub Actions); el claim "406 tests + 35 checks" no es observable con la granularidad por archivo de la salida; `DEP0190` en `init.mjs:643/651` (`shell:true`) es preexistente, idéntico en `main`.

## 2026-09-28 — Auditoría + refactor PR-0…PR-7 (instalador, tests, lib, CI)

topic: maintenance/hardening-refactor-ci
review_after: 2027-03-30
**Goal:** Auditar el harness completo y ejecutar end-to-end un plan aprobado de 7 fases (fundaciones → tests → instalador → scripts → CI → docs) para cerrar deuda real: suelo de runtime falso, cobertura de tests inexistente, instalador que no actualizaba la config y CI inexistente.
**Discoveries:** `engines: >=18` era falso — 15 scripts usan `import.meta.dirname` (>=20.11); el patrón NO anclado de `opencode.json` en `.gitignore` alcanzaba también la plantilla; `--upgrade` RESTAURABA la config desde el backup, así que AGENTS.md/opencode.json/.gitignore nunca podían actualizarse y el instalador reportaba éxito igual; el backup solo se tomaba al actualizar, no en el primer install sobre destino no vacío; los shims Bash/PS colgaban esperando un TTY; `memory-index get` devolvía solo el heading y los ids de §2 colisionaban por truncado; el loader no parseaba front-matter en CRLF ni con BOM (descripciones vacías → validación de skills saltada) y escribía su cache en comandos de lectura; las dos copias de `doctor.mjs` discrepaban en severidad (cambia el exit code); no existe fallback SQLite en ningún punto del código.
**Accomplished:** PR-1 suelo real >=20.11.0 + `.gitattributes` + LICENSE + `version:check` + paridad del check del manifest en el script ps1; PR-2 micro-framework sin deps (`test/harness.mjs`) + suite de tests y anti-drift que ahora FALLA en archivos raíz no catalogados y deriva su lista de `node --check`; PR-3 `init.mjs` única implementación (shims de ~20 líneas), backup antes de toda escritura, PRESERVE_DATA vs REGENERATED con merge de `model:` por agente, uninstall por ruta exacta, tabla de flags declarativa y contrato de exit codes (0/1/2/3/4/5); PR-4 `lib/{core,md,cache}.mjs` compartida adoptada en los 7 scripts (~20 copias duplicadas fuera) + fixes de `get`/ids/ranking, lock canónico y atómico en `memory-sync`, umbral de lock con mínimo, loader CRLF/BOM, rotación con retry de rename en Windows, paridad de severidad en `doctor`; PR-5 CI con 5 jobs (matriz 3 SO × Node 20/22/24, lint sh/ps1, límites de memoria con paridad, drift+empaquetado, pack-smoke) + `release.yml` gateada; PR-6/7 docs reales (free tier de opencode documentado, nunca sorteado en código) + CONTRIBUTING + .nvmrc.
**Next:** Fase 1 — validar en proyecto demo la puerta nueva (init `--upgrade`, doctor, `/discover` → `/routine` → `/record`) con la rama `feat/hardening-refactor-ci`; rotar SUMMARY al cambiar de semana; revisar §2 en review_after.
**Files:** `git log --oneline main..HEAD` (rama `feat/hardening-refactor-ci`; el detalle esta en git, no aqui).
**Verificación:** PASS — `npm test` exit 0: 11/11 ficheros de test (406 tests) + 35 checks de memory-rotate.test.mjs + contract (paridad espejo 40, campos sesión 6, doctor 31, `node --check` 26) + `version:check` 2.0.0. Límites OK: PROJECT_STATE 81/100 y SUMMARY 56/150 (bash y ps1 exit 0); sin rotación (límites bien; el motor solo marcaría la entrada de la semana 2026-09-21).

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
