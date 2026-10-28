# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-27 — Release 1.1.0 (minor) + hardening de CI/CD: aserción post-publish fiable, timeouts honestos

topic: release/npm-publish  <!-- relacionados: ci/reusable-concurrency-literal-groups, release/version-bump-single-source · extiende la entrada del 2026-10-21, que cubre OTRO hito (publicación de 1.0.2): no se fusiona para no perder los hallazgos OIDC -->
review_after: 2027-01-25
**Goal:** cortar el release **1.1.0** (minor) y cerrar los dos fallos que dejó el run 39656624120 (aserción post-publish con E404 a los 3 s y gate que se saltaba en reruns), decidiendo a la vez qué hacer con las colas de runners macOS arm64 sin degradar la garantía de publicación.
**Discoveries:** (1) npm tarda ~2,5 min en servir una versión recién publicada ⇒ una espera de 6×25 s (la propuesta inicial) es insuficiente; 10×30 s (~5 min) sí cubre la cola de propagación. (2) Un 404 **cacheado** sobrevive a cualquier número de reintentos ⇒ `npm view --prefer-online --registry=https://registry.npmjs.org`, sin fiarse de la cache HTTP ni de un `.npmrc` del runner. (3) Quitar el gate `steps.published.outputs.ya != 'true'` tiene una consecuencia buscada y documentada: re-ejecutar un run **histórico** (p. ej. 1.0.2) ahora falla a propósito, porque `latest` ya apunta a una versión posterior. (4) `timeout-minutes` acota cuelgues de **ejecución**, NO el tiempo en **cola**: no existe mitigación desde YAML, y recortar la matriz o `continue-on-error` publicaría en npm sin verificar macOS — inaceptable porque publicar es inmutable.
**Accomplished:** `npm run version:bump minor` ⇒ **1.1.0** en `package.json` + los 5 destinos de `version-check.mjs` (no se cortó tag: lo hace el coordinador). `release.yml`: aserción post-publish en bucle 10×30 s con `::notice::` por intento y `::error::` + exit 1 fail-closed, `--prefer-online` en ambos `npm view`, y **gate de skip quitado solo de ese paso** (publish y GitHub Release lo conservan). `ci.yml`/`release.yml`: `timeout-minutes` 20 min en los 5 jobs y 30 min en `publish`, **matriz macOS intacta**; limpieza del `git status --porcelain` huérfano al final de `pack-smoke` (resto de depuración sin aserción). Docs: ancla `v1.1.0` + "Versionado y publicación" en `README.md`, runbook de release y política de colas macOS (runs idempotentes + `gh run rerun --failed`) en `CONTRIBUTING.md`. Critic (riesgo alto): **APROBADO CON CAMBIOS**; se aplicaron los cuatro (10×30 s, `--prefer-online`, matriz intacta, límite de líneas de memoria). STATE: §1 fusionada en una fila "Release 1.0.2 / 1.1.0", §2 `release/npm-publish` actualizada **in-place** (mismo `review_after: 2027-04-18`, añadido el topic de concurrencia) y §3 (a)/(b) cerrados con (c) reformulado. Compactación para no romper el límite: §2 fusionó dos decisiones afines (`architecture/harness-placement` + `repo/dev-main-merge`, ambos topics conservados, `review_after` el más próximo) pagando la fila nueva de §4 ⇒ **99 líneas de contenido** (<100). Rotación canónica con `memory-rotate.mjs` (semana vencida, `2026-10-19 < 2026-10-26`): 7 entradas a `CHANGELOG/2026-10-19.md`, SUMMARY queda en 46 líneas con solo este hito.
**Next:** el coordinador publica: commit → `merge --ff-only` a `main` → push `main` → push `dev` → `git tag -a v1.1.0` → push tag ⇒ `release.yml` publica por OIDC. Verificar `npm view advisor-harness dist-tags.latest` = **1.1.0** y la GitHub Release. No re-ejecutar runs históricos (fallan a propósito). Ninguna acción pendiente en YAML por las colas macOS.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` exit 0 (48 passed / 0 failed, `node --check` 41 scripts, contrato PASS), `version:check` ✅ 1.1.0, `lint:sh` ✅, `check-memory-limits` ✅, `doctor` exit 0 (3 ℹ️ benignos), semántica de ambos YAML validada (timeouts, gate ausente SOLO en la verificación, `--prefer-online`, bucle 10×30, grupos de concurrencia e `id-token: write` intactos), `merge-base --is-ancestor origin/main dev` = FF_OK.
**Addendum:** publicado `1.1.0` (npm `latest` = 1.1.0 vía OIDC + attestation `slsa.dev/provenance/v1` + GitHub Release `v1.1.0` con tarball `advisor-harness-1.1.0.tgz`) por el run `40631027734` (success, 3m40s) tras un dry-run `workflow_dispatch` `40630686762` (19 jobs); la aserción post-publish funcionó en real confirmando el registry al **2º intento** (el diseño de una sola pasada habría fallado). Incidencia: `git add -A` capturó la pérdida del bit `100755` en `init.sh`/`init.mjs` → restaurado con `chmod +x` + `git update-index --chmod=+x` y `--amend` antes del push ⇒ un único commit `abfe426`; el chequeo de modos de `drift-and-packaging` en CI es la red que lo habría cazado.

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
