---
description: Registra el progreso de la sesión en la memoria persistente (SUMMARY.md + consolida decisiones en PROJECT_STATE.md).
agent: summarizer
subtask: true
---

Registra el progreso de esta sesión en la memoria persistente, siguiendo el sistema de contexto de 3 capas del proyecto.

Como Summarizer, aplica las reglas en este orden lineal (no inviertas los pasos de lock y rotación):
1. Lee `SUMMARY.md` y `PROJECT_STATE.md` antes de escribir.
2. Adquiere el lock canónico solo para escribir la memoria: `node .opencode/scripts/memory-lock.mjs acquire` (guarda el `token` de la salida). No crees el lock a mano ni hagas retry ad hoc.
3. Añade una entrada concisa en `SUMMARY.md` al inicio (tras el header), SIN listas de archivos (la fuente de detalle es `git log`): qué se hizo, decisiones clave, verificación.
4. Si hubo una decisión de diseño arquitectónico, consolídala (1-2 frases) en `PROJECT_STATE.md §2`, fusionando duplicados.
5. Si se consolida un patrón reutilizable, añádelo a `PROJECT_STATE.md §5` (Patrones de Código).
6. Libera el lock ahora, antes de rotar: `node .opencode/scripts/memory-lock.mjs release --token <token>`.
7. Con el lock ya liberado, ejecuta la rotación canónica: `node .opencode/scripts/memory-rotate.mjs rotate` (motor Node; toma y libera su PROPIO lock, gestiona marcadores, §4 y dedup). No lo invoques con tu lock tomado (evita lock busy/deadlock) y no reimplementes la rotación: usa el motor. Este `/record` es el disparador canónico; el hook post-commit es solo un backup gated (`ADVISOR_ROTATE_HOOK=1`).
8. Si `PROJECT_STATE.md §2` supera ~80 líneas, compacta (mueve decisiones superadas a `CHANGELOG/DECISIONS-ARCHIVE.md`).
9. Mantén `PROJECT_STATE.md` < ~100 líneas y `SUMMARY.md` < ~150 líneas.

Contexto a registrar: $ARGUMENTS

Detalle de archivos si el usuario lo pidiera: remítete a `git log`, no lo dupliques en SUMMARY.

Routing: aquí no se decide ruta; el trabajo previo vino de `direct/delegated/spec-lite → advisor.md §2`.

Cadena: este comando cierra `/discover` → `/routine` → `/record`.
