---
description: Compacta PROJECT_STATE.md §2 (decisiones) y §5 (patrones) manteniendo solo lo vigente y accionable.
agent: summarizer
subtask: true
---

Compacta la memoria de contexto, reduciendo `PROJECT_STATE.md` a lo esencial.

Como Summarizer:
1. Aplica locking (`.memory-lock`).
2. Lee `PROJECT_STATE.md` completo y `CHANGELOG/DECISIONS-ARCHIVE.md` si existe.
3. **§2 Decisiones**: agrupa decisiones relacionadas en 1-2 líneas. Mueve decisiones obsoletas o superadas a `CHANGELOG/DECISIONS-ARCHIVE.md` (créalo con header si no existe). Conserva solo decisiones vigentes y accionables.
4. **§5 Patrones**: elimina patrones duplicados o que ya no se usan; conserva solo los reutilizables.
5. Verifica que `PROJECT_STATE.md` quede < ~100 líneas y `SUMMARY.md` < ~150 líneas.
6. Libera el lock.

Si `PROJECT_STATE.md` ya está compacto (< ~100 líneas), indícalo y no cambies nada.
