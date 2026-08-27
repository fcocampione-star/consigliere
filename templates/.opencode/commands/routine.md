---
description: Ejecuta un ciclo completo de orquestación (plan → critica → implementa → verifica → registra) para la tarea indicada.
agent: orchestrator
subtask: true
---

Ejecuta el pipeline de orquestación completo para la siguiente tarea: $ARGUMENTS

Recordatorio de tu flujo como Orchestrator:
1. Lee `PROJECT_STATE.md` (obligatorio) y, si hace falta contexto previo, `SUMMARY.md` y el `CHANGELOG/` semanal relevante.
2. Si necesitas entender el código, delega en el subagente `explore` (read-only).
3. Diseña el enfoque con `planner` (sin tocar código) APENAS la tarea no sea trivial.
4. Si el plan implica arquitectura/migraciones/refactor, valida con `critic` antes de implementar.
5. Implementa con `builder` (respeta bash allowlist).
6. Verifica con `verifier` (typecheck/lint/tests); si falla, itera entre builder y verifier (con `git stash` como rollback si conviene).
7. No commitees automáticamente: propón el commit al final.
8. Registra el progreso con `summarizer` (solo si hubo cambios significativos).

Flags soportados (por si el usuario los usa):
- `--parallel` — lanza exploración/planificación en paralelo si la tarea lo permite.
- `--skip-verify` — omite `verifier` (solo para tareas triviales).
- `--skip-critic` — omite `critic` (default: critic para tareas arquitectónicas).
- `--model=<model>` — override del modelo para esta rutina.

Devuelve un resumen final: qué se resolvió, subagentes usados, resultado de verificación y el mensaje de commit propuesto.
