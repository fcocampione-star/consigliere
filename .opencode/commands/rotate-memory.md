---
description: Fuerza la rotación semanal de la memoria (SUMMARY → CHANGELOG/) manualmente.
agent: summarizer
subtask: true
---

Ejecuta una rotación semanal manual de la memoria persistente.

Como Summarizer:
1. Ejecuta el motor de rotación: `node .opencode/scripts/memory-rotate.mjs rotate --dry-run` y revisa el resultado; luego `node .opencode/scripts/memory-rotate.mjs rotate` para aplicarlo.
2. El motor gestiona TODO: locking (memory-lock), región de marcadores, move de la entrada más antigua a `CHANGELOG/<lunes>.md`, dedup, índice §4 de PROJECT_STATE.md y límites. No reimplementes nada con perl/sed/mkdir.
3. Si el motor reporta muchas entradas pendientes, repite hasta que ya no haya rotación (respeta su cap `--max`, default 20).
4. Compacta `PROJECT_STATE.md §2` si supera ~80 líneas (mueve decisiones superadas a `CHANGELOG/DECISIONS-ARCHIVE.md`).
5. Si no hay entradas antiguas que rotar, el motor lo indica y no cambia nada.

`/record` es el disparador canónico de la rotación; este comando es el disparo manual.
