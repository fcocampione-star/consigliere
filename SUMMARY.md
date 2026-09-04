# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

## 2026-09-04 — Fase 0 Bootstrap spec-lite → verifier PASS

topic: sdd/bootstrap-initial/spec
**Goal:** Cerrar ambigüedad harness-only y desbloquear fase inicial (3 pendientes PROJECT_STATE §3).
**Discoveries:** Stack harness ya definido pero con placeholders `Edit this table`, SKILL chunks vacíos, cache fingerprint stale, templates drift riesgo.
**Accomplished:** PROJECT_STATE §1 reescrita Fase 0 Bootstrap (61 líneas), §2 3 decisiones `architecture/harness-scope`, `architecture/stack-md-grep`, `dx/skill-loader-cache` review_after 2026-12-03, §5 2 patrones `memory/search` + `skill/chunk-load`; AGENTS stack real + 8 dev commands; SKILL _project-docs 5 chunks rellenados (6 URLs); sync templates 3 espejos diff 0; spec sdd/bootstrap-initial ≤650w R1-R7 Given/When/Then critic APROBADO.
**Next:** Push rama consigliere-2.0 (commit propuesto pendiente), activar sync chunks `.consigliere/chunks/`, iniciar Fase 1 dogfooding `/discover` → `/routine`.
**Files:** `git log --oneline -5` → d75e476, f940b8a, 4113bcb, 9d1ce97, b92eb8c — 6 modificados root+templates, sin src, sin tocar init.mjs/opencode.json
**Verificación:** `verifier PASS` 14/14 doctor, `node .opencode/skills/_skill-loader/loader.mjs list` 2 skills, `memory-index search` ok, `npm test` syntax v2.0.0, `wc -l` PROJECT_STATE 61 SUMMARY <150

## 2026-09-03 — Auditoría harness y hardening repo privado

topic: repo/hardening
**Goal:** Auditoría inicial consigliere 2.0, hacer repo privado real con harness versionado y validar dogfooding.
**Discoveries:** .gitignore trackeaba ignorando .opencode y .consigliere; README con refs globales/FACEIT/GENTLE AI; @summarizer con `*:ask` bloqueaba escritura memoria; doctor exigía 14 checks incluyendo topic y chunks.
**Accomplished:** Hardening .gitignore (1.2.3) privado con chunks/.gitkeep versionado + fix .opencode/.gitignore; AGENTS.md Stack actualizado desde README (harness OpenCode + md+grep + instalador vacío); fix @summarizer stand-alone `*:allow` (harness+template); creado explore.md read-only + builder harden sensibles; limpieza README refs globales (0 matches).
**Next:** Push rama consigliere-2.0 (4 ahead origin) tras memoria; definir objetivo/stack real en PROJECT_STATE §1 y pendientes §3; activar sync chunks si aplica.
**Files:** `git log --oneline -5` → f940b8a docs(readme), 4113bcb feat(agents), 9d1ce97 fix(summarizer), b92eb8c chore(repo)
**Verificación:** `node .opencode/scripts/doctor.mjs --json` 14/14 ✅; `grep -r "FACEIT\|GENTLE AI" README` 0 matches; `git log --oneline -4` verificado; `wc -l SUMMARY.md 31 PROJECT_STATE.md 58`

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
