# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

## 2026-09-10 — Purga F1–F6b sunset legacy completo (solo .advisor vivo)

topic: sdd/advisor-purge-improvements
**Goal:** Cerrar F6+F6b sunset: eliminar `.consigliere` y purgar LEGACY_* en init/scripts + docs.
**Discoveries:** `.consigliere` eliminado raíz+templates; LEGACY_* purgado en init/scripts raíz+templates; 6 refs docs actualizadas; demo sin `.consigliere`; doctor 15/16 (index stale no bloqueante); npm test ok. Sin commit.
**Accomplished:** Sunset F6 completo — F1–F5 (bb59a2d+dbbd3d9, fd1df61, 6dee3b6, 01600b0) + F6/F6b trabajo en árbol; solo `.advisor/` vivo (2.0). Alineación AGENT-PIPELINE local sin commitear. Decisión §2 pendiente: Advisor-only routing orgánico + SDD-lite ≤650w.
**Next:** MANUAL usuario: buildIndex para doctor 16/16; validar demo Fase 1; rotar a CHANGELOG el lunes; commitear/pushear cuando indique.
**Files:** `git log --oneline -5` → bb59a2d, dbbd3d9, fd1df61, 6dee3b6, 01600b0 (F6 en worktree, sin commit).
**Verificación:** PASS — doctor 15/16 (stale → buildIndex), npm test syntax ok v2.0.0, grep legacy 0, limits 65/100 49/150.

## 2026-09-10 — Fixes P0/P1/P2 verificados PASS

topic: maintenance/harness-fixes
**Goal:** Aplicar y verificar fixes P0/P1/P2 del harness sin commitear.
**Discoveries:** Legacy `consigliere/` anidada requería ignore anclado; renames orchestrator→advisor duplicados en routine-model.
**Accomplished:** Fixes aplicados: `.gitignore` +`/consigliere/`, PROJECT_STATE §2 decisión + review_after 2026-12-03 y §3 pendiente legacy, routine-model orchestrator→advisor x2, `_project-docs` CHUNK fix, AGENTS.md harness-only x2, cache regenerada.
**Next:** Validar demo Fase 1 (`init.mjs --upgrade`, doctor, flujo /discover→/routine→/record); rotar a CHANGELOG el lunes.
**Files:** `git log --oneline -5` → 35c35fc, 42de753, 5fbebed, aa1f864, c3fff40.
**Verificación:** doctor 14/14 PASS, npm test PASS, loader 4 skills, chunk OK.

> Cuando registres progreso (via `/record` o `summarizer`), añade entradas al inicio, tras este bloque (formato 2.0 con topic + 5 campos, compat viejo `Qué/Verificación`):

```markdown
## YYYY-MM-DD — <Título corto>

topic: <family/kebab>  <!-- ej architecture/auth, sdd/login/spec -->
**Goal:** <objetivo>
**Discoveries:** <hallazgos>
**Accomplished:** <qué se hizo y decisiones>
**Next:** <siguientes pasos>
**Verificación:** <comandos y resultado>
```

> Topic upsert: mismo `topic:` en 7d → actualiza no duplicar. No agregues listas archivos (usa `git log`). Rotación automática hook post-commit (lunes o >150 líneas) o `/rotate-memory`. Búsqueda: `node .opencode/scripts/memory-index.mjs search "query"`.

---

## Índice de historial archivado (CAPA 2)

| Semana (lunes) | Archivo |
|----------------|---------|
| (aún sin historial) | — |
