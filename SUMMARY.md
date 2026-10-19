# Session Log

> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md` — fase, decisiones, pendientes.
> **Historial archivado:** `CHANGELOG/` — una semana por archivo (ver índice en PROJECT_STATE, §4).

---

<!-- ADVISOR:ENTRIES:START -->

## 2026-10-18 — test E2E hermético del harness + Gate 0 empírico v2 ✓

topic: test/e2e-v2-empirico
**Goal:** validar el harness de punta a punta (instalador real, agentes, ciclo completo de memoria 3 capas, skills, `--upgrade`) contra el CLI OpenCode v2 real, cerrando el Gate 0 empírico que bloqueaba la migración V2 (spec `sdd/v2-compat/spec`).
**Discoveries:** `debug agents`/`debug config` hablan con un servicio global compartido y bajo carga pueden resolver vistas SOLO-builtin o sin el doc del proyecto: detección determinista + 5 reintentos con backoff 400 ms (transiente del servicio; asserts de contrato sin debilitar). Pines empíricos v2 2.0.32: `permission.bash{}`→`permissions[]` ({action,resource,effect}) SIN pérdida de reglas; `subagent_depth` strippado silenciosamente (recodificar a permiso `subagent` en la migración); claves desconocidas sin warnings; `model` "proveedor/modelo" tras `--upgrade` se normaliza a `{model, providerID}`. Hallazgo win32 de `lint:sh`: el `bash` del PATH puede ser WSL-bash (no MSYS2, destruye rutas Windows) → fix con args RELATIVOS (rutas desde el `cwd` del spawn, idéntico para Git-Bash/WSL/POSIX) y validado exit 0 con ambos intérpretes. Bug real de `requireNode()` en `init.mjs`: el comparador semver daba "Node >=20.11 requerido" en Node 26.4/25.x/23.x.
**Accomplished:** creado `test/e2e-harness-v2.test.mjs` (5 suites: instalación→Gate 0→memoria→skills→upgrade+roundtrip; 21 tests, instalación REAL con `init.mjs` en `%TEMP%`, hermético CERO deps, se auto-omite si `opencode --version` ≥2.0.0 no está); fix de `init.mjs` (semver) y de `doctor.mjs` (fallback a `templates/opencode.json` en raíz↔templates byte-idénticos).
**Next:** migración V2-nativa según spec `sdd/v2-compat/spec` (Gate 0 ya validado: estrategia V2-nativa única); menores de §3.
**Files:** `git log --oneline -5` (no listas manuales)
**Verificación:** e2e 21/21 solo y dentro de `npm test` (15/15 archivos); `npm test` PASS (48 pass + contrato paridad espejo 41 + versión 1.0.1: "harness ok"); `lint:sh` exit 0 con WSL-bash (PATH) y con Git-Bash (`ADVISOR_BASH`); `lint:ps1` exit 0.

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
