# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-25 — Lote "ágil pero robusto": medición real de sesiones, critic único, `git-state` read-only y `/record` por hito

topic: process/record-por-hito  <!-- relacionados: process/session-metrics, agents/advisor-git-readonly, process/advisor-agility-descartado -->
review_after: 2027-04-24
**Goal:** aplicar 7 recomendaciones aprobadas para hacer el harness "robusto pero ágil" bajo dos principios: rápido lo reversible, exigente lo irreversible; y rigidez solo donde se puede hacer cumplir (permisos/tests), no en prosa.
**Discoveries:** (1) la CLI de opencode v2.1.4 usa `opencode session export` (no `export`), con tokens en `messages[].tokens` (fallback `info.tokens`), y `--sanitize` por defecto **redacta los agentes** ⇒ `--no-sanitize` opt-in; (2) primera medición empírica del repo: una sesión real dio 9 delegaciones / 31 mensajes / 607.807 tokens; (3) el comodín preexistente `routine-model.mjs*` no se puede cerrar en exacto (el id de modelo es texto libre ≤80 chars) ⇒ se congela con test en vez de fingir cierre; (4) la regla del critic estaba duplicada e incoherente entre `advisor.md`, `routine.md` y `AGENT-PIPELINE.md`.
**Accomplished:** `session-metrics.mjs` (nuevo, ×2 byte-idéntico): `--from <export.json>` / `--session <id>`, delegaciones por agente, iteraciones builder→verifier, bytes de prompt y tokens, degradación honesta `{available:false}` (exit 0/1/3/5), binario `ADVISOR_OPENCODE`→PATH; test propio (15 casos) + README desambiguando estimación (`memory-tokens.mjs`) vs medición real. Regla ÚNICA del critic en `advisor.md` §2 con marcador custodio `canon:critic-routing` (obligatorio en riesgo alto; en medio si >3 archivos acoplados o contrato público; suprimirlo exige datos medidos) + punteros en `routine.md`/`AGENT-PIPELINE.md` y ban de las cadenas legacy, más carril rápido `canon:fast-lane` (1 hoja builder si ≤3 archivos, reversible, sin esquema/auth/contrato y hay test). `git-state.mjs` (nuevo, ×2): 7 subcomandos cerrados, argv fijo, ningún token del usuario que empiece por `-` (exit 1 sin spawn), recorte a 40 líneas, 7 entradas EXACTAS en la allowlist bash del advisor (`glob`/`grep`/`edit` siguen en deny) y `ahead-behind` avisa de que NO hace fetch. `/record` por hito: commit "exige `/record` si el diff toca `.opencode/`, `templates/` o `init.mjs`; solo docs/memoria puro admite `sin hito: <motivo>`". Custodia en `contract-tests.mjs` (`routing-contract` + `ALLOW_WILDCARDS`). **NO implementado (deliberado):** supresión del critic en riesgo medio (gateada a baseline), topes de hojas, `--fast` (duplicaba `--skip-verify --skip-critic`), `glob`/`grep` al advisor. El critic cambió el plan: de "frase literal en 6 ficheros" a "1 fuente + punteros + ban legacy". STATE: 3 bullets `installer/*` fusionados (topics y `review_after` conservados) y 2 pendientes nuevos en §3 para no romper el límite de 100 líneas.
**Next:** cerrar el comodín `routine-model.mjs*` cambiando su contrato de entrada y decidir la supresión del critic en medio cuando E1 acumule 2-3 sesiones medidas (§3). Riesgos residuales: `git-state` opera en `process.cwd()` (sin `-C`), el contrato fija un literal de puntero y el carril rápido solo se custodia textualmente.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` exit 0 (23/23 archivos, contrato PASS 45 espejos/48 EOL, versión 1.0.2), `test:contract` exit 0, `check-memory-limits` exit 0, `doctor` exit 0; `lint:ps1` no ejecutado (no hay `pwsh`; el lote no toca `.ps1`).

## 2026-10-24 — Plan `ADVISOR-AGILITY` evaluado y DESCARTADO (tema cerrado); `dev` sincronizado y verde

topic: process/advisor-agility-descartado  <!-- relacionados: sdd/routing-organico, process/routing-risk-deltas -->
review_after: 2027-04-24
**Goal:** sincronizar `dev` con `origin/dev` y resolver el rojo que dejó el plan `.opencode/plans/ADVISOR-AGILITY.md` en `npm test` (contrato anti-drift: `espejo: archivo solo-raíz no catalogado`).
**Discoveries:** `dev` iba 5 commits detrás (incl. `/skill-capture`, deny de `general` y el plan); sync por `fetch` + `merge --ff-only`, 0 divergentes. Evaluación con `explore` + `critic` → veredicto **posponer hasta tener datos**: el diagnóstico salía de UNA sola sesión externa (`pruebq1`) sin baseline; las 3 palancas (F1 glob/grep al advisor, F2 topes de hojas/critic solo en alto, F3 planner con `edit` por ruta + retornos por referencia) eran "hipótesis no medidas" según el propio plan; F1 erosionaba `sdd/routing-organico` y `process/routing-risk-deltas` (el tope "≤3 consultas/≤150 líneas" no es enforceable, solo prompt); la telemetría F0 emitida por el propio LLM es poco fiable; `memory-tokens.mjs` no modela topes de hojas. Colateral: el motivo del descarte previo (commit `05950a7`, ausente del clon local) nunca se documentó en memoria — queda aquí.
**Accomplished:** decisión del USUARIO: borrar el plan y dar el tema por resuelto; ninguna fase implementada. `git rm .opencode/plans/ADVISOR-AGILITY.md` (en índice, sin commit). Sin referencias residuales fuera de `CHANGELOG/`/`SUMMARY.md`/`.git`. Ideas baratas surgidas y NO adoptadas (constancia, sin pendientes): `session-metrics.mjs` sobre `opencode export`; aclarar en `advisor.md` §2 la incoherencia critic (tabla "clásico" vs "Cuándo usar critic"); sonda del test de `edit` por patrón de ruta en e2e-harness-v2. Decisión en STATE §2 con condición de reapertura.
**Next:** nada pendiente. Reabrir solo con datos reales de sesiones que muestren saltos innecesarios, medidos con script (no auto-telemetría del LLM). Commit propuesto: borrado del plan + STATE + SUMMARY.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` exit 0 (contrato anti-drift PASS, 43 espejos, 37 scripts, versión 1.0.2); `git status` solo `D` del plan.

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
