# Decisiones superadas (capa 2)

> Archive de `PROJECT_STATE.md §2`, que es append-only y solo guarda decisiones **vigentes**. Aquí caen las que una Compactación (`/compact-state`) confirmó superadas: se conservan con su motivo para que `/review` y `git log` puedan explicar por qué ya no están en §2. Lo que está en vigor se lee en `PROJECT_STATE.md §2`.
> Este archivo es memoria viva del mismo directorio que los CHANGELOG semanales: `memory-index` lo indexa (es lo que consulta `/review`) y lo crea `/compact-state` la primera vez que hace falta. Nunca se rota: no es una semana.

## 2026-09-30 — repo/legacy-ignore: superada por repo/legacy-sunset (F6)

topic: repo/legacy-ignore
review_after: 2026-12-03
**Superada por:** [repo/legacy-sunset] — el sunset F6 eliminó el fallback read-only `.consigliere/` de instaladores, scripts y `.gitignore`.
**Decisión archivada:** Copia legacy `consigliere/` anidada ignorada vía `/consigliere/` anclado en `.gitignore`, no commiteable ni parcheable (append-only).
**Por qué ya no aplica:** la copia anidada no existe en el repo y su regla de ignore salió de `.gitignore`; no queda nada que ignorar. La regla de `.gitignore` anclado (el `opencode.json` de dev con `/opencode.json`) sobrevive, pero es otra decisión y sigue en su sitio.