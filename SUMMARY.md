# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-15 — Compactación capa 0: PROJECT_STATE.md 14,5 KB→8 KB (−45% tokens fijos)

topic: memory/compact-state
**Goal:** reducir el coste fijo de contexto (capa 0, siempre cargada) sin perder decisiones vigentes ni trazabilidad por topic.
**Discoveries:** §2 concentraba el 65% del archivo con 16 líneas >220 chars que duplicaban AGENTS.md/skills/SUMMARY; `field()` solo extrae un topic por línea, así que las fusiones multi-topic habrían dejado topics huérfanos (hallazgo del critic).
**Accomplished:** recorte-sin-fusión (variante aprobada por critic): §1 5→2 filas, §2 28→27 líneas todas ≤220 chars (solo fusión permitida: contracts+git-aware con alias), §3 sin viñeta histórica, §5 8→6 filas, §6 4→2 líneas; cero archivados, `templates/` intacto.
**Next:** `/review` diciembre decide sobre las 4 decisiones con `review_after: 2026-12-03` (fusionar/archivar con señal real).
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** PASS — `doctor` PROJECT_STATE ✅ 89 líneas (<100), `test:contract` ✅, `npm test` 13/14 (fallo pre-existente `opencode.json` ausente, reproducido en limpio), `search "tar"`/`"contract-git-aware"` resuelven `state--*`, `measure` 3.582→1.980 tok, `compare spec-lite` ahorro 95,0→95,9%.

<!-- ADVISOR:ENTRIES:END -->

> Cuando registres progreso (via `/record` o `summarizer`), añade entradas al inicio, tras este bloque (formato 1.0 con topic + 6 campos, compat viejo `Qué/Verificación`):

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
