# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

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
