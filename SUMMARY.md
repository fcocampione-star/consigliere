# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-21 — Intento de release 1.0.2: deadlock de concurrencia CI + tmpdir macOS arreglados (sin publish)

topic: ci/reusable-concurrency-literal-groups  <!-- relacionados: test/tmpdir (§5), release/npm-publish, release/version-bump-single-source -->
review_after: 2027-04-21
**Goal:** publicar la 1.0.2 (merge `dev`→`main`, tag `v1.0.2`, push); el intento tumbó `release.yml` por 2 bugs preexistentes.
**Discoveries:** en workflows reusables, `github.workflow` se resuelve al nombre del CALLER — `ci.yml` invocado vía `workflow_call` heredaba "Release" y caller/callee caían en el MISMO grupo de concurrencia, auto-bloqueándose en 1 s (run 39629128099; `release.yml` no ha tenido NINGÚN run exitoso en la historia del repo). En macOS, `os.tmpdir()` devuelve `/var/folders/...` pero Node entrega `import.meta.dirname` ya canonicalizado (`/private/var/...`, `/var` es symlink): el gate de `test/e2e-harness-v2.test.mjs:542` comparaba rutas distintas (preexistente desde `fa4d9e7`).
**Accomplished:** (1) grupos de concurrencia con prefijo literal distinto por workflow: `ci-${{ github.ref }}` (cancel-in-progress: true — CI es read-only y re-ejecutable) y `release-${{ github.ref }}` (false — nunca cortar un publish a mitad); comentarios en ambos YAML citando el incidente. (2) `tmpdir()` de `test/harness.mjs` canonicaliza con `realpathSync` (punto único: es el único creador de temporales de la suite; arregla de golpe e2e:542, docProyecto y memory-rotate-extra) — sin tocar producción (`init.mjs`). (3) Regresión hermética nueva `test/harness-paths.test.mjs` (junction real en win32, sin admin). Estado del release: remoto `main`==`dev`==`a7d385b`, tag `v1.0.2` criado sobre el commit anterior pero **SIN publicar** (npm `latest` sigue `1.0.1`); fixes quedaron en el árbol sin commit. Plan acordado: mover el tag al commit arreglado tras validar con `workflow_dispatch dry-run=true` sobre `main`.
**Next:** commit de los 2 fixes + dry-run sobre `main` + re-corte del tag `v1.0.2` (push forzado del tag movido) ⇒ `release.yml` publica; la guarda skip-if-published absorbe re-runs.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` ✅ ("harness ok", 20/20 archivos), `test:contract` ✅, YAML de ambos workflows parseado y grupos de concurrencia distintos confirmados. Sin commit (decisión del coordinador).
**Addendum:** run 39649433616 falló en `publish` con `EOTP` (token granular no supera el 2FA de escritura de la cuenta) → `release.yml` migra a npm Trusted Publishing (OIDC: sin `NPM_TOKEN`, npm >=11.5.1, sin `registry-url`); tag `v1.0.2` re-cortado sobre ese commit.

## 2026-10-21 — Release 1.0.2 preparada: `version:bump` (fuente única) + guarda skip-if-published ✓

topic: release/version-bump-single-source  <!-- relacionados: release/npm-publish, tools/lint-sh-crossplatform -->
**Goal:** cerrar §3(c) (una tag de versión ya publicada rompía el release) y dejar de subir la versión a mano en 6 sitios, con un `npm run version:bump` reproducible antes de cortar la 1.0.2.
**Discoveries:** el bump manual era la última pieza sin fuente única — `version:check` vigilaba 5 destinos además de `package.json`, pero nada los reescribía. `version-check.mjs` no era importable: ejecutaba trabajo al cargarse, así que un importador moría por su side effect; además su guard hand-rolled de "¿soy main?" daba falso negativo silencioso en Windows (drive-letter, 8.3, shim `.cmd`) ⇒ se sustituye por `isMain` de `lib/core.mjs`. `readText` normaliza a LF, así que es inservible para ESCRIBIR: `init.ps1` (BOM+CRLF) y `init.sh` (modo 100755) se habrían "limpiado" como ruido en el diff.
**Accomplished:** nuevo `version:bump <patch|minor|major>` (root-only, dev-only) con `package.json` como única fuente, `--dry-run`/`--set X.Y.Z`, core puro `bump()` testeable, escritura in-place con EOL crudo (nunca `readText`), `package.json` por reemplazo in-place, rollback en `catch` y exit 0/1/2/3 (3 = regex ausente/duplicada, 2 = drift preexistente); `version-check.mjs` refactorizado a módulo puro + CLI que exporta `TARGETS`/`SKILL_VERSION_RE`/`checkVersion` sin side effects; `test/version-bump.test.mjs` nuevo (17 casos: core+CLI, drift, regex ausente, `--set`, regresión CRLF en `init.ps1`). `release.yml` gana la guarda **skip-if-published** que cierra §3(c) (`npm view` degrada a skip SOLO en `E404`; cualquier otro error falla de verdad, `::notice::`), GitHub Release idempotente (`gh release view || create`, recupera "publish OK / release KO") y aserción post-publish de versión + `dist-tags.latest`. Docs: `README` (§"Versionado y publicación", semver aplicado, cadena de release en 4 pasos, nota de que `prepublishOnly` NO corre con `npm publish <tarball>`, ancla v1.0.2), `CONTRIBUTING` (runbook) y `AGENTS` (fila del comando). Bump 1.0.1→**1.0.2** aplicado: 6 líneas 1/1, sin ruido de formato, BOM+CRLF y modo 100755 intactos. Memoria: rotación canónica movió la entrada de dev-config a `CHANGELOG/2026-10-12.md`; `PROJECT_STATE` compactado sin perder contenido (fases completadas fusionadas en §1, Gate 0 retirado de §3 ya consolidado en §2, `release/npm`+`release/version` unificados en §5) para volver a `doctor` en verde. (d) de §3 cerrado: `0.0.0-stage` ya solo vive en un comentario de `release.yml` y en el histórico, sin artefacto vivo.
**Next:** el publish NO se hizo aquí — lo hace el coordinador: merge `dev`→`main` (`--ff-only`), tag `v1.0.2`, push ⇒ `release.yml` publica (y la guarda absorbe un re-run). `latest` en npm sigue en `1.0.1` hasta entonces. `dev` va 14 commits por delante de `main` (incl. `fa4d9e7`, el `/record` de dev-config).
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` ✅ (`harness ok`, 19/19 archivos), contrato ✅ (41 espejos, 44 EOL), `lint:sh`/`lint:ps1` ✅, `doctor` exit 0 (17✅/0⚠️/0❌), `npm pack --dry-run` incluye `README.md` y excluye `.opencode/`/`test/`, YAML de `release.yml` parseado OK, EOL auditado. Sin commit.

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
