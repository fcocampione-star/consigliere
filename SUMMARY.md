# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-18 — EOL canónico al instalar (.gitattributes + render normalizado) ✓

topic: installer/eol-canonical
**Goal:** eliminar las 40+ warnings "LF will be replaced by CRLF" del commit inicial del instalador y, sobre todo, blindar los `.sh` (hook post-commit, check-memory-limits) contra conversiones CRLF de git que rompen bash (`\r: command not found`).
**Discoveries:** la regla existía declarada en `.gitattributes` de la raíz pero NO se aplicaba al escribir: `renderFile` volcaba tal cual (un template CRLF del working tree aterrizaba crudo en el destino) e `installGitHook` usaba `copyFileSync` byte-exacto. El catch-all de `renderTree` dejaba fuera `gitignore`/`.gitattributes`/`.cmd`/`.bat` (sin extensión o ext no listada). Diagnóstico verificado empíricamente: solo los `.ps1` tenían CRLF en disco (canónico ya); el resto del arbol estaba limpio — el riesgo era el working tree de OTRO contribuidor, no este.
**Accomplished:** (1) `canonicalEol()` en `init.mjs` (espejo literal del `.gitattributes`: todo→LF, `ps1|cmd|bat`→CRLF), aplicado en `renderFile`; (2) `installGitHook` normaliza a LF al instalar; (3) `renderTree` rutea por render todo lo textual + los 2 renombres; (4) nueva plantilla `templates/gitattributes` (TEMPLATE_RENAME) que declara la convención en CADA proyecto instalado; (5) `gitInitAndCommit` fija `core.autocrlf=false` LOCAL en repos fresh (best-effort, nunca global); (6) contrato nuevo `eol templates` (44 ficheros) en contract-tests; (7) test nuevo `test/eol-canonical.test.mjs` (3 tests, fixture envenenado con CRLF/LF mixto); (8) `.gitattributes` en catálogos de init.mjs (BACKUP_ITEMS/REGENERATED/PART_HARNESS/uninstallPlan), `TEMPLATE_ONLY_EXACT` y listas de init.test/e2e.
**Next:** decision anunciada cuando toque release (es fix interno de 1.0.1 publicada; bump si sale por npm); migración V2 sigue en marcha según spec.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** `test/eol-canonical.test.mjs` 3/3 (árbol envenenado instala LF puro, commit inicial SIN "LF will be replaced", hook LF en `.git/hooks/`); `node .opencode/scripts/contract-tests.mjs` PASS (nuevo `eol templates — 44`); `npm test` PASS 16/16 archivos + "harness ok"; `npm pack --dry-run` → `templates/gitattributes` viaja (420B); reinstalación empírica en `../prueba1`: cero warnings, `core.autocrlf=false` local, `ls-files --eol` pinta `w/lf`+`attr/eol=lf` (`.ps1` → `w/crlf`), hook con 0 bytes CR, doctor del proyecto instalado en verde; `lint:ps1` exit 0.

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
