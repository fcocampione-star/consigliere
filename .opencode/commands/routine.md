---
description: Ejecuta un ciclo completo de orquestación (plan → critica → implementa → verifica → registra) para la tarea indicada.
agent: orchestrator
subtask: true
---

Ejecuta el pipeline de orquestación completo para la siguiente tarea: $ARGUMENTS

Recordatorio de tu flujo como Orchestrator (routing orgánico + SDD-lite integrado, Consigliere 2.0):

0. **Memoria obligatoria**: lee `PROJECT_STATE.md` siempre; `SUMMARY.md`/`CHANGELOG/` solo on-demand.
1. **Routing**: cuenta files necesarios (grep/glob via `explore` si hace falta):
   - `direct` 1-3 files o 1 file mecánico → sin `critic`, sin spec, 1 worker.
   - `delegated` 4+ files o 2+ writes no triviales → flujo completo.
   - `spec-lite` ambigüedad duradera → pide a `planner` spec ≤650w Given/When/Then + Tasks.
2. Si necesitas entender código, delega en `explore` (read-only, cache skill via `loader.mjs list`).
3. Diseña con `planner` (sin tocar código). Si spec-lite, exige MUST/SHOULD + Given/When/Then.
4. Si plan/spec implica arquitectura/migraciones/refactor/>3 files acoplados, valida con `critic` antes de builder.
5. Implementa con `builder` (respeta bash harden: deny irreparable + ask sensibles `.env/*.pem`).
6. Verifica con `verifier` (typecheck→lint→tests barato primero); si falla, itera builder↔verifier con `git stash` rollback (max 3).
7. No commitees: propone commit al final.
8. Registra con `summarizer` (topic upsert + session summary 5 campos `Goal/Discoveries/Accomplished/Next/Files`, no listas archivos).

Flags:
- `--parallel` — exploración/planificación en paralelo si independiente.
- `--skip-verify` / `--skip-critic` — omite pasos (solo trivial).
- `--model=<m>` — override modelo para esta rutina.
- `--spec` — fuerza spec-lite aunque routing diga direct.

Devuelve: qué resolviste, ruta elegida (direct/delegated/spec-lite), spec si hubo, subagentes usados, verificación y commit propuesto.
