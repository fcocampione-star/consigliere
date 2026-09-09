# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

## 2026-09-09 — Rename consigliere→Advisor + install modular + skill sdd-lite

topic: architecture/advisor-rename
**Goal:** Completar pipeline rename consigliere→Advisor en rama chore/rename-consigliere-to-advisor (base 85a72a2) sin commitear.
**Discoveries:** sdd-lite no existía como skill (solo concepto en orchestrator); doctor 12/14 por warnings ambientales (hook/backups), no bloqueantes.
**Accomplished:** Rename display Advisor, npm advisor-harness, bin triple + alias consigliere-harness; dual-dir .advisor/ vivo + fallback .consigliere/ read-only + .migrated; CACHE_VERSION 2, prune ^(harness|advisor)- keep5, --upgrade=--part all, scripts install/uninstall/update --part harness|memoria|autoskills + --status/--dry-run/--force/--restore, skill nueva _sdd-lite (3 skills); decisión §2 architecture/advisor-rename review_after 2027-03-04. Iteraciones builder↔verifier: 0 (PASS a la primera, sin stash).
**Next:** Commitear + push rama (propuesto, no automático); Fase 1 dogfooding install modular en proyecto demo.
**Files:** rama chore/rename-consigliere-to-advisor sobre 85a72a2, working tree modificado sin commits ni push (ver `git status --short`)
**Verificación:** npm test OK, node --check x9 OK, bash -n OK, pwsh 0 errores, npm pack advisor-harness@2.0.0 OK, doctor 12/14 (2 warnings ambientales), loader 3/3 + chunk OK, diff solo placeholders, rg solo allowlist, memory-index encuentra topic

## 2026-09-09 — Spec SDD-lite advisor-rename-modular-install

topic: sdd/advisor-rename-modular-install/spec
Spec SDD-lite ≤650w (RFC2119, Given/When/Then por criterio): rename display/npm/bin + dual-dir vivo/fallback + migración copia; --upgrade=--part all + prune combinado keep5; install modular por partes con --status/--dry-run/--force/--restore; skill _sdd-lite como 3ª skill cargable.

## 2026-09-04 — Fix docs/instaladores: consigliere-init roto → npx consigliere@latest

topic: dx/docs-fix-consigliere-init
**Goal:** Cerrar 3 huecos (P0/P1/P2) de docs/instaladores del harness v2.0.0 que rompían la primera experiencia del paquete.
**Discoveries:** `npx consigliere-init` no existe (es bin del paquete `consigliere`, no paquete npm propio); `/compact-state` y `/rotate-memory` NO son flags CLI de init.mjs (el parser los trataría como ruta de proyecto) sino slash-commands de `.opencode/commands/`; README referenciaba `cache.mjs` inexistente (loader real = `loader.mjs` + SKILL.md con cache fingerprint en `.consigliere/`).
**Accomplished:** Reemplazado `npx consigliere-init` por `npx consigliere@latest` en README/init.mjs/init.sh/init.cmd; check-memory-limits.{sh,ps1} (raíz+templates) referencian `'/compact-state'`/`'/rotate-memory'` en opencode; árbol de agents incluye `explore.md` (orden real); descripción _skill-loader corregida (sin cache.mjs); nuevo bloque "Primeros pasos (30 segundos)" tras tagline + blockquote descarga adelgazado reenviando al paso 2. Decisión: en mensajes de instalador, slash-commands opencode ≠ flags CLI de init.mjs.
**Next:** Fase 1 dogfooding: validar `npx consigliere@latest` en proyecto demo real + flujo `/discover → /routine → /record`.
**Files:** `git log --oneline -5` → 1bdd711, f585133, eaddba7, d75e476, f940b8a (fix aún en working tree, sin commit)
**Verificación:** `rg "consigliere-init"` solo package.json:7 (bin legítimo); `rg "cache.mjs"` 0; `node --check init.mjs` + `bash -n` ok; `npm test` ok (syntax v2.0.0); `doctor.mjs` 14/14; diff templates↔raíz sin salida.

## 2026-09-04 — Fix gap --upgrade: preservación memoria/config viva

topic: architecture/upgrade-preserve
**Goal:** Cerrar gap `--upgrade` en instalación previa (init.mjs/init.sh/init.ps1 + README): preservar memoria/config viva al refrescar solo el código harness.
**Discoveries:** El gate dir-no-vacío bloqueaba upgrade en proyectos existentes; sin backup completo el re-render pisaba PROJECT_STATE/SUMMARY/opencode.json; flags `--model-*` no aplican en no-interactivo (modelos van ''), opencode.json se restaura del backup.
**Accomplished:** Gate eximido solo con marcador de harness (`.opencode/` o `AGENTS.md`); backup completo keep 5 con excludes (`.consigliere/backups`, `.memory-lock`); auto-restauración de PROJECT_STATE/SUMMARY/opencode.json/AGENTS.md/.gitignore desde backup tras re-render; aborta (exit≠0) si el backup falla; `--dry-run` planifica backup+restore sin escribir; help/README actualizados (tar requerido para --upgrade, opencode.json en raíz). Decisión consolidada en PROJECT_STATE §2.
**Next:** Validar `--upgrade` en proyecto demo real (Fase 1 dogfooding) y push rama consigliere-2.0.
**Files:** `git log --oneline -5` → f585133, eaddba7, d75e476, f940b8a, 4113bcb
**Verificación:** `node --check init.mjs` + `bash -n init.sh` + `npm test` ok; `doctor.mjs --json` 14/14; smoke `/tmp`: marcas custom sobreviven, tar sin recursividad, keep 5, gate sin marcador aborta.

## 2026-09-04 — Spec SDD-lite upgrade-preserve

topic: sdd/installer-upgrade-preserve
Spec SDD-lite ≤650w (RFC2119, Given/When/Then por criterio): C1 gate eximido con marcador harness (`.opencode/` o `AGENTS.md`); C2 backup completo keep 5 + excludes (`.consigliere/backups`, `.memory-lock`); C3 restauración memoria/config tras re-render + aborto (exit≠0) si backup falla; C4 mensajes claros + `--dry-run` plan backup+restore sin escribir.

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
