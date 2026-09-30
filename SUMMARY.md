# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-09-28 — Auditoría + refactor PR-0…PR-7 (instalador, tests, lib, CI)

topic: maintenance/hardening-refactor-ci
review_after: 2027-03-30
**Goal:** Auditar el harness completo y ejecutar end-to-end un plan aprobado de 7 fases (fundaciones → tests → instalador → scripts → CI → docs) para cerrar deuda real: suelo de runtime falso, cobertura de tests inexistente, instalador que no actualizaba la config y CI inexistente.
**Discoveries:** `engines: >=18` era falso — 15 scripts usan `import.meta.dirname` (>=20.11); el patrón NO anclado de `opencode.json` en `.gitignore` alcanzaba también la plantilla; `--upgrade` RESTAURABA la config desde el backup, así que AGENTS.md/opencode.json/.gitignore nunca podían actualizarse y el instalador reportaba éxito igual; el backup solo se tomaba al actualizar, no en el primer install sobre destino no vacío; los shims Bash/PS colgaban esperando un TTY; `memory-index get` devolvía solo el heading y los ids de §2 colisionaban por truncado; el loader no parseaba front-matter en CRLF ni con BOM (descripciones vacías → validación de skills saltada) y escribía su cache en comandos de lectura; las dos copias de `doctor.mjs` discrepaban en severidad (cambia el exit code); no existe fallback SQLite en ningún punto del código.
**Accomplished:** PR-1 suelo real >=20.11.0 + `.gitattributes` + LICENSE + `version:check` + paridad del check del manifest en el script ps1; PR-2 micro-framework sin deps (`test/harness.mjs`) + suite de tests y anti-drift que ahora FALLA en archivos raíz no catalogados y deriva su lista de `node --check`; PR-3 `init.mjs` única implementación (shims de ~20 líneas), backup antes de toda escritura, PRESERVE_DATA vs REGENERATED con merge de `model:` por agente, uninstall por ruta exacta, tabla de flags declarativa y contrato de exit codes (0/1/2/3/4/5); PR-4 `lib/{core,md,cache}.mjs` compartida adoptada en los 7 scripts (~20 copias duplicadas fuera) + fixes de `get`/ids/ranking, lock canónico y atómico en `memory-sync`, umbral de lock con mínimo, loader CRLF/BOM, rotación con retry de rename en Windows, paridad de severidad en `doctor`; PR-5 CI con 5 jobs (matriz 3 SO × Node 20/22/24, lint sh/ps1, límites de memoria con paridad, drift+empaquetado, pack-smoke) + `release.yml` gateada; PR-6/7 docs reales (free tier de opencode documentado, nunca sorteado en código) + CONTRIBUTING + .nvmrc.
**Next:** Fase 1 — validar en proyecto demo la puerta nueva (init `--upgrade`, doctor, `/discover` → `/routine` → `/record`) con la rama `feat/hardening-refactor-ci`; rotar SUMMARY al cambiar de semana; revisar §2 en review_after.
**Files:** `git log --oneline main..HEAD` (rama `feat/hardening-refactor-ci`; el detalle esta en git, no aqui).
**Verificación:** PASS — `npm test` exit 0: 11/11 ficheros de test (406 tests) + 35 checks de memory-rotate.test.mjs + contract (paridad espejo 40, campos sesión 6, doctor 31, `node --check` 26) + `version:check` 2.0.0. Límites OK: PROJECT_STATE 81/100 y SUMMARY 56/150 (bash y ps1 exit 0); sin rotación (límites bien; el motor solo marcaría la entrada de la semana 2026-09-21).

## 2026-09-23 — Remediación harness de memoria F0–F5

topic: memory/remediation-f0-f5
review_after: 2026-12-21
**Goal:** Cerrar 5 fases de remediación del harness de memoria (locking, rotación, sync, routing, anti-drift).
**Discoveries:** Lock atómico por mkdir sin `flock`/`perl`/`sed`; `mondayOf` UTC único evita divergencias; rotación por lunes de cada entrada hace innecesaria la por-semana; hook post-commit es riesgo de concurrencia → gated off.
**Accomplished:** F0 commit-ask + stale[] + review_after; F1 lock canónico + helpers stats + motor único + marcadores + shim gated; F2 import idempotente + locking unificado; F3 parser regiones/O(n)/JSON tolerante/ids sin colisión; F4 routing por clase de riesgo + deltas + spec-lite persistida; F5 contract-tests anti-drift. Decisiones §2 actualizadas.
**Next:** commitear F5 cuando indique; validar demo Fase 1; rotar lunes; revisar en review_after.
**Files:** `git log --oneline -5` → 63b85ef, 0c95c11, fdb38e7, 47ca385, 34c45ad, 4dd0c28.
**Verificación:** PASS — npm test 36 checks + contract tests, espejos sincronizados, doctor sin ❌/⚠️ nuevos, límites 65/98/8.

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
