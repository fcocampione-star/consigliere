# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

## 2026-09-11 — Fix templates instalables: AGENTS.md orientado al proyecto + doctor por capas A/B/C

topic: sdd/project-templates-clean
review_after: 2026-12-10
**Goal:** Templates instalables sin refs internas: AGENTS.md proyecto-orientado, doctor regenerable, docs enmascaradas.
**Discoveries:** Sentinel ADOPTION-STACK + placeholders {{STACK_*}}/{{LANG_BACKEND}}/{{DEV_COMMANDS}} aíslan AGENTS.md del repo; doctor capas A/B/C (exit solo capa A, infra/adopción ℹ️ sin fix-loop); _skill-loader raíz+templates divergen por diseño.
**Accomplished:** templates/AGENTS.md con placeholders + sentinel + sección "Harness (no tocar)" sin rutas; templates doctor.mjs por capas con fix --upgrade; docs enmascaradas (_project-docs, check-memory-limits); nota divergencia _skill-loader. Raíz AGENTS/doctor/_project-docs/check-memory NO tocados por el fix.
**Next:** commitear cuando indique; rotar lunes; revisar en review_after.
**Files:** `git log --oneline -5` → e208ff3 (fix en worktree, sin commit; templates + skills + scripts).
**Verificación:** PASS — doctor exit 0, 12✅ 5ℹ️ 0❌/⚠️, grep refs 0, sentinel presente, npm test ok.

## 2026-09-11 — Installer zero-flags: happy path sin args + --quick/-y + --interactive + help por capas

topic: sdd/installer-zero-flags
review_after: 2026-12-10
**Goal:** Instalador sin flags: 0 prompts en dir vacío, determinista, paridad mjs/sh/ps1.
**Discoveries:** AUTO_CHOICE=3 hace el happy path determinista; prompt MODEL_* colapsable en 1 (coma-separado); ps1 pierde menú y adopta flags posicionales + Show-Help paridad; pwsh no disponible → ps1 validado estático.
**Accomplished:** Happy path sin args (0 prompts, resumen 3 líneas); --quick/-y forzado respeta --dir/posicional tras fix; --interactive nuevo; help por capas (Uso rápido 3 líneas + avanzado + Genera/Flujo); CI-safe </dev/null. Decisión: interactivo explícito, default determinista.
**Next:** commitear feat/installer-zero-flags cuando indique; rotar lunes.
**Files:** `git log --oneline -5` → 88d9376 (feat en worktree, sin commit; init.mjs/sh/ps1 modificados).
**Verificación:** PASS — node --check, bash -n, npm test ok, demos /tmp ok + limpiados.

## 2026-09-11 — Comunicación adaptativa §8 (educador/practicante/copiloto/auto) + /modo

topic: sdd/communication-adaptive
review_after: 2026-12-10
**Goal:** Detectar nivel de usuario por señales (sin preguntar) y adaptar estilo con reglas anti-molestia.
**Discoveries:** /modo sesión-only propaga a subagentes; espejo raíz↔templates solo {{PROJECT_NAME}}; doctor 15/16 (index stale pre-existente, no bloqueante).
**Accomplished:** advisor.md §8 con 4 modos + 6 reglas anti-molestia; command /modo nuevo; AGENTS.md línea pipeline; _project-docs chunk communication + refresh; README. Decisión: comunicación adaptativa por señales, sin preguntar nivel.
**Next:** commitear feat/communication-adaptive cuando indique; rotar lunes; revisar en review_after.
**Files:** `git log --oneline -5` → 84c1d02 (feat en worktree, sin commit).
**Verificación:** PASS — doctor 15/16 (stale → buildIndex), npm test ok, loader chunk communication ok.

## 2026-09-11 — Release B+A empaquetado público limpio (npm pack + git archive)

topic: release/publico
review_after: 2026-12-10
**Goal:** Preparar release público: excluir runtime/privado de paquete y repo sin romper demo ni doctor.
**Discoveries:** `.advisor` (chunks/.migrated/manifest) y `.agents` son runtime; `dev/` no debe viajar; git archive filtraba por gitignore parcial.
**Accomplished:** `.gitignore` runtime anclado (`.advisor` chunks/.migrated/manifest, `.agents`, opencode.json), `.gitattributes` `export-ignore dev/` raíz, `git rm --cached` de chunks+manifest+opencode.json, package.json `files` OK. Decisión: dev/ solo local.
**Next:** commitear cuando indique; verificar `npm publish --dry-run`; rotar lunes.
**Files:** `git log --oneline -5` → 4eb42ee, bb59a2d, dbbd3d9, fd1df61, 6dee3b6 (B+A en worktree).
**Verificación:** PASS — ls-files 0 dev, npm pack 38 files (init+templates) 68.8kB, git archive sin fuga, demo install exit 0, doctor 16/16, npm test ok.

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
