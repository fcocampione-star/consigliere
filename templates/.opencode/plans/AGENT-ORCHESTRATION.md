# AGENT-ORCHESTRATION — Sistema de agentes del proyecto

> Plan de diseño del pipeline de agentes. Referenciado desde `PROJECT_STATE.md`. Generado por el harness CONSIGLIERE.

## Estado

✅ Implementado por `consigliere init` (harness).

## Objetivo

Reducir el desorden de contexto en sesiones largas delegando el trabajo en agentes especializados, manteniendo la memoria persistente de 3 capas (`PROJECT_STATE` / `SUMMARY` / `CHANGELOG`).

## Arquitectura

```
                       +───────────────────────+
                       │  orchestrator          │  primario (junto a build/plan)
                       │  (orquesta + critica)  │
                       +───────────┬───────────+
      task: explore|planner|critic|builder|verifier|summarizer  (allow)
                ┌─────┴──┬─────┴─────┬─────┴────┬──────┴─────┬──────┴─────┐
                │        │           │          │            │            │
            explore   planner      critic    builder      verifier    summarizer
            (built-in, (plano,     (revisa    (implementa,  (verifica,   (documenta,
             read-only) sin cod.)   diseño)    no delega)    no edita)    no delega)
```

## Decisiones clave

- **Agentes como markdown**: `.opencode/agents/*.md` (convención oficial, per-project).
- **Orquestador estricto**: `permission` del orquestador con `edit/glob/grep/bash/webfetch: deny`. Su único mecanismo de acción es elaborar prompts autocontenidos y delegar vía `task`. Cada prompt delegado exige estructura: Contexto / Objetivo / Alcance-restricciones / Formato de retorno.
- **Modelos por subagente**: tag `model` en `.opencode/opencode.json` (placeholders al generar; el usuario los rellena). Modelos baratos para verifier/summarizer/explore; caros para builder/planner/critic.
- **Profundidad**: hojas (`planner/builder/verifier/critic/summarizer`) tienen `permission.task: deny`. Solo el orchestrator delega; `subagent_depth: 2` permite que planner delegue en explore si es estrictamente necesario.
- **Bash allowlist en builder**: comandos destructivos (rm -rf, git push, sudo, etc.) denegados. Reducir riesgo de daño accidental.
- **Critic**: revisor de diseño entre planner y builder para cambios arquitectónicos (tablas, migraciones, refactor, patrones nuevos).
- **Cuándo invocar `critic`** (reglas concretas): delega en `critic` **antes** de `builder` cuando el plan propone:
  - Nuevo cambio arquitectónico (tabla, esquema/RLS, patrón, refactor estructural).
  - Migraciones, changes rompedores o deuda técnica.
  - El plan afecta a más de 3 archivos o módulos acoplados.
  - Se propone cambiar tipos de datos clave, APIs públicas, o contratos de base de datos.

- **Commits propuestos, no automáticos**: builder/verifier dejan el commit como propuesta (`git commit/push/amend → ask`).
- **Memoria persistente**: el orchestrator SIEMPRE lee `PROJECT_STATE.md` primero; SUMMARY/CHANGELOG on-demand.

## Archivos

- `.opencode/agents/orchestrator.md` — primario coordinador (estricto, solo delega).
- `.opencode/agents/planner.md`, `builder.md`, `verifier.md`, `critic.md`, `summarizer.md` — hojas.
- `.opencode/opencode.json` — `default_agent: orchestrator`, `subagent_depth: 2`, `instructions: [AGENTS.md]`, `agent.*.model`, `permission.builder.bash` (allowlist).
- `.opencode/commands/routine.md` — `/routine <tarea>`: ciclo completo.
- `.opencode/commands/record.md` — `/record <contexto>`: registrar progreso.
- `.opencode/commands/rotate-memory.md` — rotación manual.
- `.opencode/commands/compact-state.md` — compactación de PROJECT_STATE.

## Verificación

- Reglas de permission de agentes: `task` con globs (last-match wins, `"*": ask` primero).
- Commands con `agent: <nombre>` + `subtask: true`.
- Al dejar `agent.*.model` vacío, el subagente hereda el modelo del invocador; al rellenarlo se fuerza ese modelo.

## Pendientes / posibles mejoras

- Asignar `model` concreto a cada subagente en `.opencode/opencode.json` cuando el costo lo justifique (placeholders actualmente).
- Sobrescribir permisos finos por role concreta del proyecto.
- Añadir agente `tester` dedicado (escribir tests) si el proyecto lo requiere.
