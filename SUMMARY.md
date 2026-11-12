# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-11-12 - Rutas sensibles sin carpeta en shell y `session-metrics --session` en Windows

topic: agents/shell-sensitive-paths, tools/session-metrics-win32
review_after: 2027-05-12
**Goal:** cerrar §3 (d) `cat .env` sin carpeta no casaba `cat **/.env*` y el sub-pendiente (1) del benchmark: `session-metrics --session` fallaba en Windows (ENOENT).
**Discoveries:** (1) `cat **/X` no casa rutas sin carpeta; como `shell *` es allow, `cat .env`, `cat server.pem`, `cat secrets/x` corrían sin preguntar. (2) `session-metrics` tenía dos fallos: el resolvedor probaba primero la extensión vacía y elegía el script sh de npm (`...\npm\opencode`) en vez de `opencode.cmd`, y Node no lanza .cmd/.bat sin shell. (3) Una sesión real medida con `--session`: ~12M tokens, casi todo caché.
**Accomplished:** 4 reglas `ask` (`cat .env*`, `cat *.pem`, `cat *.key`, `cat secrets/*`) en builder y summarizer (raíz + templates) con aserción en `test/wiring-basic.test.mjs` (5 comandos sin carpeta → ask). `session-metrics.mjs` (raíz + templates): extensión vacía al final en PATHEXT y .cmd/.bat vía `ComSpec /d /s /c` (seguro: id validado por `SESSION_ID_RE`, flags fijas).
**Next:** `type`, `Get-Content`, `less`, `head` NO cubiertos (solo `cat`; requiere decisión de diseño); el texto de builder.md:65 no lista las rutas sin `**/`; sin test unitario del caso .cmd; siguen publicar 2.0.0, `lint:ps1`, benchmark T2, compactar PROJECT_STATE.
**Files:** `git diff` (no listas manuales)
**Verificación:** `npm test` verde (23/23, contrato 45 espejos, versión 2.0.0); `doctor` 0 errores previo; `session-metrics --session` real exit 0.

## 2026-11-11 - Migración del harness a OpenCode V2.2.7 (solo V2), versión 2.0.0

topic: release/v2-only
review_after: 2027-05-11
**Goal:** migrar el harness a OpenCode V2.2.7 abandonando 1.x y preparar 2.0.0 (rama `dev`, sin commitear).
**Discoveries:** (sondas CLI 2.2.7) `subagent_depth` raíz se ignoraba (`planner→explore` nunca funcionó); con `experimental.subagent_depth` 1 un subagente no lanza otro, con 2 sí (nivel 3 rechazado). 6 subagentes simultáneos sin errores (N=4 es decisión del harness; coste no medido). Frontmatter V2 y `agent.permission` V1 se SUMAN. Comandos compuestos (`&&`, `;`) denegados contra allowlist `echo ok*` (no probado contra la allowlist real). `debug agents` muestra permisos de frontmatter; `explore` comparte id con el built-in V2. Hueco heredado: `cat **/.env*` no casa `cat .env`.
**Accomplished:** 7 agentes con `permissions:` V2 nativo (fuente única; `templates/opencode.json` sin permisos por agente); `lib/md.mjs` (`agentPermissions`/`resolvePermission`), `doctor`, contract-tests (`permisos fuente única`); 9 comandos `subtask`→`subagent`; `init.mjs` detecta claves V1 y avisa al `--upgrade`; regla `canon:parallel-fanout` en advisor.md; README/AGENTS/AGENT-PIPELINE/doctor.md actualizados. §2: 4 decisiones nuevas, `advisor-init-shell` cerrada, `advisor-git-readonly` y `e2e-v2-empirico` actualizadas.
**Next:** commit (exige este `/record`), tag `v2.0.0` y ff `dev`→`main`; pendientes (a)–(f) en §3 (steps hojas, hard-deny F5, model nativo F7, `cat .env`, `lint:ps1`).
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` verde (23/23 archivos, contrato, e2e V2.2.7, `version:check` 2.0.0).

## 2026-11-11 - Advisor puede ejecutar el instalador (`node init.mjs*`)

topic: agents/advisor-init-shell
review_after: 2027-05-11
**Goal:** que el `advisor` ejecute `init.mjs` (`--status`/`--upgrade`) sin delegar en `builder`.
**Discoveries:** los permisos del advisor existen duplicados (frontmatter del `.md` y `opencode.json`) con tests de paridad; no se sabe qué fuente prevalece si discrepan. Abierto, sin refactor decidido: probar empíricamente con el CLI antes de unificar (riesgo alto, planner+critic).
**Accomplished:** entrada estrecha `"node init.mjs*": allow` con `"*": deny` intacto, en `advisor.md` + espejo `templates/`, `templates/opencode.json` (`agent.advisor.permission.bash`) y `opencode.json` raíz (gitignored); §0 actualizado; `test/wiring-basic.test.mjs` ajustado (`ALLOW_WILDCARDS` + `esperado`). Supersede PARCIAL de `agents/advisor-git-readonly` (ahora 2 comodines: `routine-model.mjs*` e `init.mjs*`). Corregidas afirmaciones obsoletas de «único comodín» en README y PROJECT_STATE §3.
**Next:** si se quiere unificar permisos advisor (.md vs opencode.json), medir primero cuál prevalece.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` verde; `node init.mjs <dir> --status` funcionó; `--upgrade` (con backup) de AsistConfgPc y su advisor.md lleva la entrada (líneas 20 y 43).

## 2026-11-11 - Sync dev/main, validación VERDE, fan-out empírico y piloto T1 del bench A/B (no discrimina)

topic: process/bench-ab
review_after: 2027-05-11
**Goal:** sincronizar `dev`/`main`, validar los 11 commits pendientes, medir el fan-out real de subagentes y ejecutar un piloto (T1) del benchmark A/B advisor-6 vs planner→builder.
**Discoveries:** (1) Fan-out: 6 subagentes lanzados a la vez, 3 con solape medido (`verifier`/`builder`/`summarizer`); `planner→explore` sin probar en runtime. (2) Piloto T1 (README, riesgo bajo, 1 corrida/modo): A 110.941 tok/1,14 min/7 msgs/+5−7; B 150.872 tok/1,05 min/8 msgs/+7−9; ratio B/A 1,36, casi todo en caché; ambos correctos (1 archivo, vías por proyecto intactas). A solo delegó en `builder`+`verifier` y B no llamó al planner: la tarea era demasiado fácil (criterio = grep) → **no discrimina**; n=1; la percepción de "mucho más rápida" no se confirmó. (3) Herramienta: `session-metrics --session` falla en Windows (`ENOENT`, shim `.cmd`; solo `--from <export>`); `opencode export --sanitize` no existe en v2.2.6 (`opencode session export <id>`, sin sanitizar); `explore`/`critic`/`planner` sin shell no se auto-cronometran.
**Accomplished:** `dev`/`main` sincronizadas (`0cb2676`); validación VERDE de los 11 commits; diseño del bench fijado (§3 `process/bench-ab`); piloto T1 ejecutado y cerrado por el usuario como terminado; commits `f7ff316` y `3f4b5f9`. El bench de 6 corridas NO se ejecutó. Sin decisión estructural nueva (§2 intacta).
**Next:** sustituir T1 por una tarea T2 de riesgo medio/alto donde el advisor deba planificar (planner/critic/explore) y repetir con n>1; resolver los 3 hallazgos de herramienta antes si se quiere automatizar la medición.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** validación VERDE de los 11 commits; piloto: ambos modos correctos (`global`=0, `gentle`=0, 1 archivo).

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
