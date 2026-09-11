# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

## 2026-09-11 — Purga F1 migrateAgentRename PASS

topic: sdd/advisor-purge-improvements
**Goal:** Purgar función legacy migrateAgentRename de instaladores sin commitear.
**Discoveries:** Función obsoleta post-rename orchestrator→advisor; solo 3 líneas GLOBAL restantes (fuera de instaladores).
**Accomplished:** Eliminadas migrateAgentRename (init.mjs ~52L +2 calls), migrate_agent_rename (init.sh ~43L +2 calls), Migrate-AgentRename (init.ps1 ~53L +2 calls).
**Next:** Commit a demanda; validar demo Fase 1; rotar a CHANGELOG el lunes.
**Files:** `git log --oneline -5` → 35c35fc, 42de753, 5fbebed, aa1f864, c3fff40.
**Verificación:** rg 0 en instaladores, node --check OK, bash -n OK, doctor 14/14, npm test syntax OK v2.0.0, demo /tmp/demo-advisor exit 0.

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
