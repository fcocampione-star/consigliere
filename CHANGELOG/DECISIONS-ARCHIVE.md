# Decisiones superadas (capa 2)

> Archive de `PROJECT_STATE.md §2`, que es append-only y solo guarda decisiones **vigentes**. Aquí caen las que una Compactación (`/compact-state`) confirmó superadas: se conservan con su motivo para que `/review` y `git log` puedan explicar por qué ya no están en §2. Lo que está en vigor se lee en `PROJECT_STATE.md §2`.
> Este archivo es memoria viva del mismo directorio que los CHANGELOG semanales: `memory-index` lo indexa (es lo que consulta `/review`) y lo crea `/compact-state` la primera vez que hace falta. Nunca se rota: no es una semana.

## 2026-09-30 — repo/legacy-ignore: superada por repo/legacy-sunset (F6)

topic: repo/legacy-ignore
review_after: 2026-12-03
**Superada por:** [repo/legacy-sunset] — el sunset F6 eliminó el fallback read-only `.consigliere/` de instaladores, scripts y `.gitignore`.
**Decisión archivada:** Copia legacy `consigliere/` anidada ignorada vía `/consigliere/` anclado en `.gitignore`, no commiteable ni parcheable (append-only).
**Por qué ya no aplica:** la copia anidada no existe en el repo y su regla de ignore salió de `.gitignore`; no queda nada que ignorar. La regla de `.gitignore` anclado (el `opencode.json` de dev con `/opencode.json`) sobrevive, pero es otra decisión y sigue en su sitio.

## 2026-10-11 — repo/dev-main-split: superada por repo/dev-main-merge (D2)

topic: repo/dev-main-split
review_after: 2027-04-18
**Superada por:** [repo/dev-main-merge] — el modelo D2 descarta la proyección por contenido (`scripts/strip-dev.mjs` eliminado): `dev` (integración) y `main` (estable) son ambos el repo completo y se promociona con `--ff-only`.
**Decisión archivada:** `dev` = repo completo (desarrollo: `test/`, `.github/`, `scripts/`, `CONTRIBUTING.md`, `.nvmrc` + dev-tools); `main` = proyección de DISTRIBUCIÓN (harness + memoria, sin dev-only) regenerada desde `dev` por `scripts/strip-dev.mjs` (temp GIT_INDEX_FILE + read-tree dev^{tree} + exclusión index-only + inyección de `opencode.json` desde templates/ + write-tree + allowlist + commit-tree parent=main + update-ref CAS; idempotente por tree hash; `--push` opt-in con `--force-with-lease`, nunca `--force`). `main` NO se mergeaba desde `dev` (se regeneraba). El paquete npm se publicaba desde `dev` (tag `v*`) y `package.json` quedaba intacto en `main` a propósito (`prepublishOnly` roto = guardarraíl).
**Por qué ya no aplica:** se descartó la proyección por contenido; el filtrado dev-only vive en npm (`files`) y en el source archive (`export-ignore`), no en una rama. `main` es ahora un repo completo idéntico a `dev` tras cada promoción FF.