# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-09-23 — Remediación harness de memoria F0–F5

topic: memory/remediation-f0-f5
review_after: 2026-12-21
**Goal:** Cerrar 5 fases de remediación del harness de memoria (locking, rotación, sync, routing, anti-drift).
**Discoveries:** Lock atómico por mkdir sin `flock`/`perl`/`sed`; `mondayOf` UTC único evita divergencias; rotación por lunes de cada entrada hace innecesaria la por-semana; hook post-commit es riesgo de concurrencia → gated off.
**Accomplished:** F0 commit-ask + stale[] + review_after; F1 lock canónico + helpers stats + motor único + marcadores + shim gated; F2 import idempotente + locking unificado; F3 parser regiones/O(n)/JSON tolerante/ids sin colisión; F4 routing por clase de riesgo + deltas + spec-lite persistida; F5 contract-tests anti-drift. Decisiones §2 actualizadas.
**Next:** commitear F5 cuando indique; validar demo Fase 1; rotar lunes; revisar en review_after.
**Files:** `git log --oneline -5` → 63b85ef, 0c95c11, fdb38e7, 47ca385, 34c45ad, 4dd0c28.
**Verificación:** PASS — npm test 36 checks + contract tests, espejos sincronizados, doctor sin ❌/⚠️ nuevos, límites 65/98/8.

<!-- ADVISOR:ENTRIES:END -->

> Cuando registres progreso (via `/record` o `summarizer`), añade entradas al inicio, tras este bloque (formato 2.0 con topic + 6 campos, compat viejo `Qué/Verificación`):

```markdown
## YYYY-MM-DD — <Título corto>

topic: <family/kebab>  <!-- ej architecture/auth, sdd/login/spec -->
**Goal:** <objetivo>
**Discoveries:** <hallazgos>
**Accomplished:** <qué se hizo y decisiones>
**Next:** <siguientes pasos>
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** <comandos y resultado>
```

> Topic upsert: mismo `topic:` en 7d → actualiza no duplicar. No agregues listas archivos (usa `git log`). Rotación canónica en `/record` vía motor Node (`memory-rotate.mjs`); hook post-commit opcional/gated (`ADVISOR_ROTATE_HOOK=1`); `/rotate-memory` como disparo manual. Búsqueda: `node .opencode/scripts/memory-index.mjs search "query"`.

---

## Índice de historial archivado (CAPA 2)

| Semana (lunes) | Archivo |
|----------------|---------|
| (aún sin historial) | — |
