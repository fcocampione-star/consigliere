---
description: Ejecuta un ciclo completo de orquestación (plan → critica → implementa → verifica → registra) para la tarea indicada.
agent: advisor
subtask: true
---

Ejecuta el pipeline de orquestación completo para la siguiente tarea: $ARGUMENTS

Recordatorio de tu flujo como Advisor (routing orgánico + SDD-lite integrado, Advisor 2.0):

0. **Memoria obligatoria**: lee `PROJECT_STATE.md` siempre; `SUMMARY.md`/`CHANGELOG/` solo on-demand.
1. **Routing** por **clase de riesgo** (el conteo de files es solo desempate; usa grep/glob via `explore` si hace falta):
   - `direct` riesgo bajo (cambio mecánico/localizado, pocos files, sin esquema/auth/contrato) → sin `critic`, sin spec, 1 worker.
   - `delegated` riesgo medio/alto (esquema/auth/contrato/migración/irreversible/arquitectura, o varios files acoplados / 2+ writes no triviales) → flujo completo.
   - `spec-lite` ambigüedad duradera → pide a `planner` spec ≤650w Given/When/Then + Tasks.
2. Si necesitas entender código, delega en `explore` (read-only, cache skill via `loader.mjs list`).
3. Diseña con `planner` (sin tocar código). Si spec-lite, exige MUST/SHOULD + Given/When/Then.
4. Si plan/spec implica arquitectura/migraciones/refactor/>3 files acoplados, valida con `critic` antes de builder.
5. Implementa con `builder` (respeta bash harden: deny irreparable + ask sensibles `.env/*.pem`).
6. Verifica con `verifier` (typecheck→lint→tests barato primero); si falla, itera builder↔verifier con `git stash` rollback (max 3).
7. No commitees: propone commit al final.
8. Registra con `summarizer` (topic upsert + session summary 6 campos `Goal/Discoveries/Accomplished/Next/Files/Verificación`, no listas archivos).

Flags:
- `--parallel` — exploración/planificación en paralelo si independiente.
- `--skip-verify` / `--skip-critic` — omite pasos (solo trivial).
- `--model=<m>` — override global para esta rutina (`node .opencode/scripts/routine-model.mjs --model=<m>`).
- `--model-<agent>=<m>` — override por agente (`advisor|planner|builder|verifier|critic|summarizer|explore`); ej. `node .opencode/scripts/routine-model.mjs --dry-run --model-builder foo`.
- `--persist` — guarda overrides en `opencode.json` (merge atómico); `--dry-run` — previsualiza sin escribir.
- `--spec` — fuerza spec-lite aunque routing diga direct.
- Nota: `--model-*` solo resuelve via `routine-model.mjs`; el instalador (`init.mjs`, sección de prompts de modelo: `interactiveCreate` con `MODEL_AGENT` y `checkModelInputs`) solo ofrece prompts interactivos, sin flags CLI.
- **Free tier de opencode**: el harness solo valida la FORMA de un id de modelo (`MODEL_RE` en `routine-model.mjs` y en el instalador), nunca si ese id tiene entitlement. Si un subagente falla con `OpenCode's free tier can only be used from within OpenCode`, el error lo emite opencode: no reintentes. Las dos vías son un modelo que no sea del free tier para ese agente, o `opencode auth login` (ver § "Modelos del free tier" del README).

Cierra la rutina con `/record` (cadena `/discover` → `/routine` → `/record`).

Devuelve: qué resolviste, ruta elegida (direct/delegated/spec-lite), spec si hubo, subagentes usados, verificación y commit propuesto.
