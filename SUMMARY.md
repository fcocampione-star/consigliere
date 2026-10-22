# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-22 — Ramas `feat/advisor-agility` + `fix/init-autoskills-flag` borradas SIN integrar (trabajo a rehacer)

topic: architecture/advisor-agility  <!-- relacionados: installer/autoskills (§5, fila de diagnóstico) · metrics/advisor-telemetry (mediciones válidas, NO afectadas) -->
**Goal:** dejar constancia fiel de que la Fase 0 ADVISOR-AGILITY (telemetría al cierre) y el fix de `--autoskills` NO están en `dev` ni en `main`: ambas ramas se borraron sin integrar por decisión explícita del usuario (advertida de antemano).
**Discoveries:** `e03f241` (Fase 0 ADVISOR-AGILITY: telemetría obligatoria al cierre + plan `.opencode/plans/ADVISOR-AGILITY.md`), `a2ef759` (fix `--autoskills`) y `7d1ffa7` (merge) solo viven en el **reflog** ⇒ ni el código ni las filas de memoria que los describían llegaron a `dev`; el árbol está en el estado previo. Ventana finita: el reflog expira, así que la recuperación es ahora — `git branch feat/advisor-agility 7d1ffa7` (y `fix/init-autoskills-flag` en `a2ef759`).
**Accomplished:** auditado el estado real (`git log`/`git branch -a`/`git reflog`/`git cat-file -e`): `dev` en `7c7c2a1` sin rastro del trabajo, el plan NO existe en disco y `init.mjs:1149` conserva el gate `autoChoice !== '3'` (o sea, el bug sigue vivo). Memoria corregida sin borrar historia: §3 reabre la Fase 0 (el plan vuelve a "sin implementar") y el menor `--autoskills`; §2 deja UNA decisión de estado (`architecture/advisor-agility`: trabajo a rehacer, 80/20 = permisos y topes); §5 reconvierte `installer/autoskills` en patrón de DIAGNÓSTICO (flag = selector; `npx` falso en `PATH` para testear sin red). **Sigue siendo válido del trabajo perdido:** el diagnóstico de `--autoskills` (es un **selector** 1|2|3, no una cantidad: `3` omite por diseño y el parseo siempre fue correcto) y la identificación del **bug real** (aviso de omisión muerto por el gate `autoChoice !== '3'`, modos 1/2 sin tests, `warn` genérico al fallar `npx`) — se citan aquí para no re-diagnosticar.
**Next:** rehacer en `dev` (a) el fix de `--autoskills` (gate + tests de modos 1/2 con fake `npx` en `PATH` + `warn` con causa) y (b) la Fase 0 ADVISOR-AGILITY desde el plan recuperado; nada de esto bloquea el release. Las mediciones `metrics/advisor-telemetry` son datos reales y se mantienen intactas.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `git reflog --oneline` (los 3 commits sin rama: `e03f241`/`a2ef759`/`7d1ffa7`), `git branch -a` (solo `dev`/`main`, cero ramas locales del trabajo), `git cat-file -e 7d1ffa7:.opencode/plans/ADVISOR-AGILITY.md` OK frente a `HEAD:.opencode/plans/ADVISOR-AGILITY.md` = "does not exist"; `doctor` exit 0, límites 100/150 OK, `memory-index.mjs search "autoskills"` localiza esta entrada y el estado nuevo.

## 2026-10-22 — Feat `/skill-capture`: memoria → skills reales (ciclo memoria→skill cerrado) + fix de fidelidad

topic: process/skill-capture  <!-- relacionados: process/discover-gaps (supersede parcial) · patrón skill/consolidar en §5 -->
**Goal:** cerrar el pendiente fase 2 de §3: consolidar decisiones/patrones de memoria (§2/§5 por topic) en skills reales con contenido, no solo esqueletos — el skill-new canónico desde memoria — y que la skill generada sea **reusable tal cual** (sin placeholders ni texto mutilado).
**Discoveries:** composición sobre lo existente, sin motor nuevo: `skill-capture.mjs` reutiliza exports de `skill-scaffold.mjs` (scaffolding/frontmatter) y `memory-index.mjs` (lectura md+grep); fail-closed "≥1 fuente" — un topic que solo tiene §3 pendientes NO se rescata ⇒ no se genera skill vacía; el parser acepta `[topic:]` y `[topics:]` plural (formato de compactación de §2). Plan validado por critic antes de implementar. Defecto real de calidad detectado al usar la herramienta: chunks declarados en el frontmatter sin contenido (placeholders `(pendiente: contenido de …)`) y entradas SUMMARY/CHANGELOG cortadas a la primera línea.
**Accomplished:** feat: `skill-capture.mjs` + command `/skill-capture` (+ espejo templates, paridad byte): match exacto o prefijo de categoría, dedup por slugId, cap `--summary N` por sección de origen, nombres `_` reservados, `--write`/`--force`, dry-run por defecto; `skill-scaffold` queda esqueleto puro y `/discover` intacto; **supersede parcial** de `process/discover-gaps` (solo cae "sin `/skill-new`"). Fix de calidad (SIN commit aún, 3 files): chunks vacíos filtrados del frontmatter y del cuerpo ⇒ cero placeholders; entradas SUMMARY/CHANGELOG con texto íntegro vía lectores exportados (`entriesRegion` de memory-stats, `parseRegion`/`headingToId` de memory-rotate — `memory-index.mjs` intacto, sus tests sin tocar); `renderCapture` → null sin chunks ⇒ exit de uso. Micro-fix cosmético (2026-10-22, mismo ciclo): `stripMeta()` elimina `[topic:]/[topics:]` y `review_after: YYYY-MM-DD` del cuerpo renderizado (decisiones/patrones/entradas/pendientes) con guard de code spans — no mutila la sintaxis citada entre backticks; script raíz + espejo + tests. STATE: §3 cerrado + cláusula "reusable tal cual" y "metadatos fuera del cuerpo" en §2 (in-place, 0 líneas netas) + fila `skill/consolidar` en §5.
**Next:** nada bloqueante (§3 menor del filtrado cerrado hoy). Commit propuesto de los 5 files (script raíz+espejo, test, STATE, SUMMARY) — la memoria va DENTRO del commit.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` verde (unit 21/21, skill-capture 22/22, contract PASS, rotación + versión 1.0.2). Dry-run de reuso real en 3 fases: captura `agents/frontmatter-yaml-escape` → SKILL.md 1022 B con chunks `[decisiones, patrones]`, 0 placeholders; A/B **ciego** con `explore`: el agente con skill propuso la forma canónica validada `"C:\\algo\\*": allow`, citó la regla textual y acotó su certeza; el control recomendó comillas simples (no validadas) y dudó del matcher; limpieza verificada (skill temporal borrada, loader 3 skills, `doctor` 0, `git status` solo los 3 files del fix). Micro-fix: skill-capture **26/26**, unit 21/21, contract PASS, `npm test` "harness ok"; snapshot del chunk `patrones` **limpio** (cero `[topic:`/`review_after:`), `doctor` exit 0, límites 100/150 OK, lock free.

## 2026-10-22 — Fix: subagente `general` denegado en advisor (built-in fuera del pipeline)

topic: process/general-deny  <!-- relacionados: agents/task-perms (§5), sdd/routing-organico · cierra pendiente "fase 2: general task ask→deny" de CHANGELOG/2026-10-12 -->
**Goal:** `general` era alcanzable vía `task` del advisor pese a no estar definido en `.opencode/agents/` — cerrar el hueco de routing del pipeline de 7 agentes.
**Discoveries:** `general` es agente BUILT-IN de opencode (no del harness). En este entorno el runtime NO aplicó el `task: "*": ask` del frontmatter de advisor al invocarlo (los tools difieren del runtime de opencode.json); el cierre explícito debe ser `deny`, no `ask`.
**Accomplished:** `general: deny` añadido a `permission.task` en `.opencode/agents/advisor.md` + espejo `templates/.opencode/agents/advisor.md` (paridad byte a byte; los 6 allows y `"*": ask` intactos). README/AGENTS: `general` documentado como built-in de opencode FUERA del pipeline de 7 agentes, denegado en advisor. Fix sin commit — el coordinador propone commit tras este cierre de memoria. STATE: pendiente fase 2 en §3 + patrón `agents/task-perms` en §5; §2 compactado por familias (runtime/* y tools/* agrupadas con `[topics: …]`, contenido ±0) para mantener <100 líneas.
**Next:** pendiente diferido a fase 2 en STATE §3: feat `/skill-capture` (topic process/discover-gaps), requiere planner + critic. Commit propuesto de los 4 archivos modificados.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** VERDE previo al registro: `npm test` 0 fallos, `test:contract` PASS, `doctor` 0 ⚠/❌.

## 2026-10-21 — Release 1.0.2 publicada en npm vía Trusted Publishing (OIDC) ✓

topic: release/npm-publish  <!-- relacionados: ci/reusable-concurrency-literal-groups, release/version-bump-single-source -->
review_after: 2027-04-21
**Goal:** cerrar el release 1.0.2: publicar `advisor-harness@1.0.2` desde `release.yml` y dejar la publicación sin tokens.
**Discoveries:** 4 bloqueos en cadena: (1) secret con nombre equivocado (`NODE_AUTH_TOKEN` en vez de `NPM_TOKEN`) → ENEEDAUTH; (2) token granular frenado por "Require 2FA for write actions" de la cuenta → EOTP; (3) migración a OIDC (npm `^11.5.1` en publish, sin `registry-url` en setup-node por setup-node#1551); (4) Trusted Publisher en npmjs.com con "Allow npm publish" sin marcar → `E403 OIDC permission denied for this action` (solo permitía `stage publish`). Aparte, 2 cancelaciones de jobs macOS por falta de runners (capacidad de GitHub, no código; `rerun --failed`). Anomalía: el paso "verificar en el registry" corrió 3 s tras el publish y dio E404 (npm tardó ~2,5 min en servir la versión) ⇒ run 39656624120 en rojo con todo publicado.
**Accomplished:** npm `latest` = **1.0.2** con provenance SLSA v1 (attestation en el registry), publicado por OIDC desde `6c5431e` (tag `v1.0.2`). GitHub Release `v1.0.2` creada a mano con el tarball oficial de npm (shasum `bd2a7104…`). Limpieza de seguridad (usuario): token granular "Consigliere Harness" revocado, secrets `NPM_TOKEN`/`NODE_AUTH_TOKEN` borrados (0 secrets verificado), Publishing access en "Require 2FA and disallow bypass 2fa tokens" (confirmado por el usuario; no verificable por CLI). Smoke test del paquete publicado (Windows, Node 24, tmp): `npx advisor-harness@1.0.2` `--version` OK, instalación no interactiva OK, `doctor` sin ⚠️/❌, `--upgrade` con backup y memoria preservada; los 3 bins (`advisor`, `advisor-harness`, `consigliere-harness`) → `init.mjs`.
**Next:** endurecer `release.yml` (§3: reintentos en la verificación post-publish, quitar el gate `ya != 'true'` de ese paso, mitigar colas macOS arm64). Nada bloqueante.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm view advisor-harness dist-tags.latest` = 1.0.2, attestation presente, `gh secret list` vacío, smoke test OK; `doctor` exit 0 tras este registro.

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
