---
description: Lista decisiones stale con review_after vencido (inspirado Engram mem_review).
agent: summarizer
subtask: true
---

Lista decisiones en `PROJECT_STATE.md §2` cuyo `review_after:` esté vencido (fecha < hoy, formato `YYYY-MM-DD`). También revisa `CHANGELOG/DECISIONS-ARCHIVE.md` si existe.

Para cada decisión stale reporta: línea original, `review_after`, días vencido, recomendación (`mark_reviewed` extiende +90d, o `replanificar`/`archivar`).

Uso: `/review` (listar) o `/review --mark <topic>` (el advisor delega en summarizer para actualizar `review_after` a +90d).

No inventes fechas; usa `date +%Y-%m-%d` real. No edites si solo es `/review` lista.
