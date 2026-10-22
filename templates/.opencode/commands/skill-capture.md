---
description: Consolida la memoria del proyecto (decisión §2, patrón §5, entradas SUMMARY/CHANGELOG y pendientes §3 por topic) en una SKILL real en .opencode/skills/<name>/SKILL.md.
agent: advisor
subtask: true
---

Consolida la memoria del proyecto para el topic indicado en una skill REAL (no esqueleto vacío): $ARGUMENTS

Como Advisor, **no leas código ni ejecutes bash directamente** — delega todo via `task` con prompts autocontenidos. Sigue este pipeline:

### 1. Memoria obligatoria
Lee `PROJECT_STATE.md` (tú, directo): decisiones §2 del topic (`[topic: x]` y también el plural `[topics: a, b]`), patrones §5 que lo mencionan e ítems §3 pendientes. `SUMMARY.md`/`CHANGELOG/` solo on-demand.

### 2. Contexto del topic (delega en `explore` — read-only)
Lanza `task` a `explore` con prompt:
- **Contexto:** topic `<topic>` (argumento del usuario); `PROJECT_STATE.md` ya leído por tí.
- **Objetivo:** confirmar las fuentes consolidables del topic y qué nombre de skill derivar:
  1. Inventario de memoria: `node .opencode/scripts/memory-index.mjs search "<topic>" --json` y `list --json` (decisiones §2 del topic — acepta el plural `[topics:]` —, patrones §5 y entradas SUMMARY/CHANGELOG con ese topic).
  2. Pendientes §3 del mismo topic: son AÑADIDOS marcados "(pendiente)", nunca la única fuente (el script es fail-closed: sin ≥1 fuente de {§2, §5, SUMMARY/CHANGELOG} sale con uso).
  3. Skill name: último segmento del topic (`dx/skill-search-registry` → `skill-search-registry`), override solo si el usuario pasó `--name`.
- **Restricciones:** read-only, no edites, no escribas skills.
- **Retorno:** lista de fuentes por sección (texto/entrada + origen) + skill name propuesto, o "solo pendiente §3" si el topic no tiene fuente consolidable (detiene antes del builder).

### 3. Dry-run → revisión → escritura (delega en `builder`)
Lanza `task` a `builder` con prompt:
- **Contexto:** fuentes del paso 2 + flags cerrados: `--name <name>` (o derivado), `--description "<una línea>"`, `--chunks <a,b,c>` (default `decisiones,patrones,entradas`), `--summary N` (entradas máx. por sección de origen, default 6).
- **Objetivo (en orden, el builder valida cada paso):**
  1. **Dry-run** (imprime el consolidado por stdout, no escribe):
     ```bash
     node .opencode/scripts/skill-capture.mjs <topic> --name <name> --description "<descripción>"
     ```
  2. **Revisión** del output: el consolidado debe describir de verdad la decisión/patrón/entradas del topic (no esqueleto vacío), con encabezado "Fuentes consolidadas" y los ítems §3 marcados *(pendiente)*. Si el contenido queda vacío o desvirtúa las fuentes, vuelve al paso 1 con `--description`/`--chunks` mejorados; si el topic solo tiene pendientes §3, reporta y termina (fail-closed).
  3. **Escritura** (solo con el consolidado revisado):
     ```bash
     node .opencode/scripts/skill-capture.mjs <topic> --name <name> --description "<descripción>" --write [--force]
     ```
     Sin `--force` salvo que el SKILL.md ya exista y el usuario haya aprobado sobrescribirlo. Verificar tras escribir: `node .opencode/skills/_skill-loader/loader.mjs list` muestra la skill nueva.
- **Restricciones:** `--write` solo en la 3ª pasada; nunca edite el SKILL a mano (regenera con flags).
- **Retorno:** ruta del SKILL escrito, fuentes consolidadas (sección + count) y verificación del loader (o por qué se detuvo).

### 4. Veredicto y cierre
Si el builder detuvo en fail-closed (topic solo pendiente §3), informa: el topic existe como pendiente en `PROJECT_STATE.md §3` pero no tiene aún decisión/patrón/entradas que capturar; sugiere registrar primero la decisión con `/record` y repetir después de `/skill-capture <topic>`.

Cierre con:
1. Ruta final `.opencode/skills/<name>/SKILL.md` + chunks + fuentes consolidadas.
2. ¿Qué la skill captura y qué quedó pendiente (§3 marcado)?
3. Sugerir `/record` para registrar la generación de la skill (topic upsert, no listas de archivos). Sin commits automáticos.

Routing: la escritura de una skill nueva es riesgo bajo→medio; si deriva en trabajo mayor (varias skills, refactor de memoria) aplica `advisor.md §2` (direct/delegated/spec-lite).

Cadena: `/discover` (auditoría) sugiere skill nueva → builder la creaba con `skill-scaffold.mjs` (esqueleto) → `/skill-capture` la consolida con contenido real de memoria → `/record` registra el cierre.
