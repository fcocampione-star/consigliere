---
description: Audita el contexto del proyecto y las skills disponibles/faltantes (stack real vs AGENTS.md vs _project-docs vs autoskills) y propone mejoras.
agent: advisor
subtask: true
---

Audita el contexto del proyecto y el estado de skills para la carpeta actual. Contexto adicional del usuario: $ARGUMENTS

Como Advisor, **no leas código ni ejecutes bash directamente** — delega todo via `task` con prompts autocontenidos. Sigue este pipeline:

### 1. Memoria obligatoria
Lee `PROJECT_STATE.md` (tú, directo) y, si existe, `SUMMARY.md` (solo si el usuario pide historial). Esto te da fase, decisiones §2, patrones §5 y pendientes §3.

### 2. Inventario del proyecto (delega en `explore`)
Lanza `task` a `explore` con prompt:
- **Contexto:** proyecto en `.` , `PROJECT_STATE.md` fase/decisiones ya leídas, `AGENTS.md` tabla Stack como referencia.
- **Objetivo:** inventariar stack REAL vs declarado. Lee: `package.json`/`pnpm-lock.yaml`/`yarn.lock`/`bun.lockb`, `pyproject.toml`/`requirements.txt`, `go.mod`, `Cargo.toml`, `*.csproj`, `.opencode/skills/_project-docs/SKILL.md` (qué chunks están vacíos), `.agents/skills/*/SKILL.md` (si existe), `AGENTS.md` sección Stack y Dev commands, y un `glob` de `src/**/*` para detectar framework real (imports).
- **Restricciones:** read-only, no edites.
- **Retorno:** tabla: `Tech declarada (AGENTS.md) | Tech detectada (archivos) | Coincide? | Fuente` + lista de skills presentes: `project (.opencode/skills/*)` y `autoskills (.agents/skills/*)` + `_project-docs` chunks vacíos vs llenos.

### 3. Mapeo de skills (delega en `planner` — read-only)
Lanza `task` a `planner` con prompt:
- **Contexto:** entrega el inventario de `explore` + contenido de `AGENTS.md` y `PROJECT_STATE.md §2/§5`.
- **Objetivo:** mapear cada tech detectada a skill necesaria. Para ello el planner debe (via bash permitido `git status/diff/log` + `webfetch`): simular `node .opencode/skills/_skill-loader/loader.mjs list` y `loader.mjs search "<tech>"` (leyendo SKILL.md + frontmatter), y verificar `npx autoskills --dry-run` lógico (qué skills autoinstalables faltan según dependencias). No toques código.
- **Retorno:** tabla `Tech | Skill esperada | Existe? (project/autoskill) | Acción` + gaps priorizados (faltantes, _project-docs URLs vacías, AGENTS.md desfasado).

### 4. Veredicto y plan de mejora
Con ambos retornos, sintetiza y entrega al usuario:

1. **Contexto del proyecto:** fase actual, stack declarado vs real, estructura detectada (1-2 líneas).
2. **Skills presentes:** lista `.opencode/skills/*` + `.agents/skills/*` (con `loader.mjs list` count).
3. **Gaps:** `_project-docs` chunks vacíos, autoskills faltantes, AGENTS.md desactualizado.
4. **Plan de mejora priorizado:**
   - `npx autoskills` si faltan autoskills (indica comando exacto `cd . && npx --yes autoskills`)
   - Rellenar `.opencode/skills/_project-docs/SKILL.md` chunks `urls/patterns/shortcuts` (indica qué URLs oficiales añadir)
   - Actualizar `AGENTS.md` tabla Stack si hay desfase
   - Si builder/verifier necesitan nuevos `allow` por stack (ej. `python*`, `go*`), indicar que ya es `*: allow` (no acción).
5. **Siguiente paso recomendado:** `/routine "<tarea>"` o `/record` si solo fue auditoría.

No edites archivos ni instales skills automáticamente — solo propón comandos. Si el usuario confirma, el siguiente `/routine` ejecutará los cambios via `builder`.
