# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-18 — `opencode.json` dev gitignored (`dev:config`) + causa raíz de §3(e) ✓

topic: dx/dev-config-gitignored  <!-- relacionados: agents/frontmatter-yaml-escape, test/wiring-basico -->
**Goal:** dar al repo dev una `opencode.json` raíz reproducible sin ensuciar git ni el tarball, y cerrar §3(e) (los agentes `builder`/`summarizer` que `debug agents` no resolvía) con causa raíz DEMOSTRADA, no supuesta.
**Discoveries:** la causa de §3(e) era el escalar YAML del frontmatter, no el config: `"del /f /s C:\*": deny` (`\*` no es escape válido en comillas dobles) hacía que opencode descartara esos 2 agentes; el experimento controlado (`debug agents` v2.0.32, `vistasBuiltin=0`, con reintentos) dio frontmatter roto + sin config ⇒ faltan `builder`/`summarizer`; frontmatter normalizado + SIN config ⇒ resuelven los 7 (migración V2 y config ausente quedan descartados como causa); con config presente los 7 resuelven siempre, o sea el config **enmascara** el defecto. Corolario: un wiring/`doctor` que solo mira el config no habría cazado el bug, y la ausencia de config raíz era ruido que lo escondía ⇒ el config raíz pasa a **prerequisito duro** (sin fallback a `templates/`) y el wiring se verifica contra el mirror real, no contra la nada. Footgun de orden: `routine-model --persist` reescribe el config raíz si existe, pero cae a `.opencode/opencode.json` (NO ignorado) si no ⇒ `dev:config` SIEMPRE antes de `--persist`.
**Accomplished:** nuevo `dev-config.mjs` (root-only, dev-only) que renderiza `templates/opencode.json` con `{{MODEL_*}}`→`""` (LF, JSON válido), con `--check`/`--force` y no-op sin `--force` si ya existe; atajo `npm run dev:config` (fuera de `test`/`pretest`: los tests siguen read-only); CI (`ci.yml`+`release.yml`) deja de sembrar con `cp` y usa la misma fuente única; `doctor.mjs` pierde el fallback a `templates/` (raíz + espejo); frontmatter corregido a `C:\\*` en las 4 copias con paridad byte a byte; `test/wiring-basic.test.mjs` pasa a exigir el config raíz presente (7 agentes, cero `{{`, `--check` como assert de frescura) y `test/dev-config.test.mjs` (12 tests) lo cubre. Doc en `CONTRIBUTING.md`/`README.md`/`AGENTS.md`. Memoria: §2 fusiona `installer/upgrade-split` + `installer/backup-previo` → `installer/upgrade-backup` (mismo contenido, una línea, headroom recuperado tras las 2 decisiones nuevas) y §3(e) sale del bloque de pendientes dejando solo el puntero a la causa.
**Next:** vigilar que un clon limpio falle ruidoso y que nadie "arregle" el ❌ reintroduciendo el fallback; pendientes menores (a)-(d) de §3 siguen abiertos.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `npm test` 18/18 y contrato `✅ PASS` (41 espejos); `lint:sh`/`lint:ps1`/`version:check` exit 0; `doctor --json` 0❌/0⚠️; `dev:config` no-op a la segunda y `--check` exit 0; LF puro; `git check-ignore` OK; `init.mjs`/`.gitattributes`/`.gitignore` sin cambios; `git archive`/`npm pack` sin el config ni el script. Sin commits.

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
