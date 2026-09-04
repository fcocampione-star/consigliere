---
description: Registra el progreso de la sesión en la memoria persistente (SUMMARY.md + consolida decisiones en PROJECT_STATE.md).
agent: summarizer
subtask: true
---

Registra el progreso de esta sesión en la memoria persistente, siguiendo el sistema de contexto de 3 capas del proyecto.

Como Summarizer, aplica las reglas:
1. Aplica el **locking** (`.memory-lock`) antes de escribir en SUMMARY.md o PROJECT_STATE.md.
2. Lee `SUMMARY.md` y `PROJECT_STATE.md` antes de escribir.
3. Añade una entrada concisa en `SUMMARY.md` al inicio (tras el header), SIN listas de archivos (la fuente de detalle es `git log`): qué se hizo, decisiones clave, verificación.
4. Si hubo una decisión de diseño arquitectónico, consolídala (1-2 frases) en `PROJECT_STATE.md §2`, fusionando duplicados.
5. Si se consolida un patrón reutilizable, añádelo a `PROJECT_STATE.md §5` (Patrones de Código).
6. Si la semana cambió o `SUMMARY.md` supera ~150 líneas, rota la entrada más antigua a `CHANGELOG/<lunes-semana>.md` y actualiza el índice de PROJECT_STATE §4 y SUMMARY.
7. Si `PROJECT_STATE.md §2` supera ~80 líneas, compacta (mueve decisiones superadas a `CHANGELOG/DECISIONS-ARCHIVE.md`).
8. Mantén `PROJECT_STATE.md` < ~100 líneas y `SUMMARY.md` < ~150 líneas.
9. Libera el lock (`.memory-lock`) al terminar.

Contexto a registrar: $ARGUMENTS

Detalle de archivos si el usuario lo pidiera: remítete a `git log`, no lo dupliques en SUMMARY.
