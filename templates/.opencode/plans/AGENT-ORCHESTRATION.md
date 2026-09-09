# AGENT-ORCHESTRATION — Sistema de agentes del proyecto

> Plan de diseño del pipeline de agentes. Referenciado desde `PROJECT_STATE.md`. Generado por el harness ADVISOR.

## Estado

✅ Implementado por `advisor init` (harness).

## Objetivo

Reducir el desorden de contexto en sesiones largas delegando el trabajo en agentes especializados, manteniendo la memoria persistente de 3 capas (`PROJECT_STATE` / `SUMMARY` / `CHANGELOG`).

## Arquitectura

```
                       +───────────────────────+
                       │  advisor               │  primario (junto a build/plan)
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
- **Profundidad**: hojas (`planner/builder/verifier/critic/summarizer`) tienen `permission.task: deny`. Solo el advisor delega; `subagent_depth: 2` permite que planner delegue en explore si es estrictamente necesario.
- **Routing orgánico 2.0** (Gentle AI trigger-rules inspirado, md+grep): `direct` 1-3 files vs `delegated` 4+ files/2+ writes no triviales vs `spec-lite` (ambigüedad duradera). Integrado por defecto en `routine` y `planner` (§2 Routing).
- **SDD-lite integrado**: `planner` genera spec ≤650w MUST/SHOULD + Given/When/Then + Tasks checklist cuando detecta ambigüedad; `summarizer` persiste como `topic: sdd/<name>/spec` con upsert.
- **Bash harden 2.0**: `deny` irreparable + `ask` sensibles (`**/.env*`, `**/*.pem`, `**/*.key`, `**/secrets/*`, `~/.ssh/*`, `~/.aws/credentials`, `git push`).
- **Critic**: revisor entre planner y builder para arquitectura/migraciones/refactor; invoca si `delegated` y >3 files acoplados o spec-lite.
- **Cuándo invocar `critic`** (2.0): antes de `builder` cuando plan/spec propone:
  - Cambio arquitectónico (tabla, esquema/RLS, patrón, refactor), migraciones/breaking/deuda, >3 files acoplados, tipos/APIs/contratos DB.

- **Commits propuestos, no automáticos**: `git commit/push/amend → ask`.
- **Memoria 2.0**: advisor SIEMPRE lee `PROJECT_STATE.md`; SUMMARY/CHANGELOG on-demand; topic upsert + stale `review_after` + búsqueda `memory-index.mjs` + sync local `memory-sync.mjs`.

## Archivos 2.0

- `.opencode/agents/advisor.md` — primario, routing orgánico + SDD-lite.
- `.opencode/agents/planner.md` — con spec Given/When/Then; `builder.md` harden; `summarizer.md` topic upsert; `verifier.md`/`critic.md`.
- `.opencode/opencode.json` — `default_agent: advisor`, `depth 2`, `model` cheap vs strong, `bash` harden v2.0.
- `.opencode/commands/routine.md` — `/routine` routing+spec-lite; `/discover`; `/doctor`; `/review`; `/record`; `/rotate-memory`; `/compact-state`.
- `.opencode/skills/_skill-loader/loader.mjs` — con cache fingerprint `.advisor/skill-registry.cache.json` + `refresh`.
- `.opencode/scripts/memory-index.mjs` — search/timeline/get (md+grep); `memory-sync.mjs` export/import; `doctor.mjs`.
- `.opencode/hooks/post-commit-memory-rotate.sh` — rotación + sync export.

## Verificación

- Reglas de permission de agentes: `task` con globs (last-match wins, `"*": ask` primero).
- Commands con `agent: <nombre>` + `subtask: true`.
- Al dejar `agent.*.model` vacío, el subagente hereda el modelo del invocador; al rellenarlo se fuerza ese modelo.

## Estado 2.0

Advisor 2.0 implementado: solo por proyecto (cero global), routing `direct/delegated/spec-lite`, harden sensibles, skill-cache, doctor, memoria topic+stale+sync. Solo `opencode`.

## Pendientes / posibles mejoras futuras

- Asignar `model` concreto por subagente (cheap vs strong) según costo.
- Permisos finos por proyecto.
- Ventana sync cloud opcional (hoy solo local `.advisor/chunks/`).
