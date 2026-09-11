---
description: Fuerza la rotación semanal de la memoria (SUMMARY → CHANGELOG/) manualmente.
agent: summarizer
subtask: true
---

Ejecuta una rotación semanal manual de la memoria persistente.

Como Summarizer:
1. Aplica locking (`.memory-lock`).
2. Determina el lunes de la semana de la entrada más antigua de `SUMMARY.md`.
3. Si existe `CHANGELOG/YYYY-MM-DD.md` para esa semana, úsalo; si no, créalo con el header estándar.
4. Mueve la entrada más antigua (con su `---`) a ese archivo y bórrala de SUMMARY.md.
5. Actualiza el índice de historial archivado en SUMMARY.md y la sección §4 de PROJECT_STATE.md.
6. Compacta `PROJECT_STATE.md §2` si supera ~80 líneas (mueve decisiones superadas a `CHANGELOG/DECISIONS-ARCHIVE.md`).
7. Libera el lock.

Si no hay entradas antiguas que rotar, indícalo y no cambies nada.
