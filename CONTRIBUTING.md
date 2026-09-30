# Contributing — consigliere / advisor-harness

Flujo de desarrollo del harness. Esto es un repo **sin dependencias**: no hay `package.json` con `dependencies`, ni lockfile, ni `npm ci`. Todo lo que se instala es código del propio repo.

## Requisitos

- **Node.js >= 20.11.0** (`.nvmrc` = 20). Es el suelo duro: el harness usa `import.meta.dirname`, disponible desde 20.11.
- Bash 4+ o PowerShell 5.1+ (solo para los lanzadores y los scripts de shell), `git` y `tar`.

## Antes de tocar nada

1. Lee `PROJECT_STATE.md` (capa 0 de la memoria, siempre). `SUMMARY.md` y `CHANGELOG/` solo si necesitas histórico.
2. Recuerda el reparto de la memoria: `PROJECT_STATE.md`, `SUMMARY.md` y `CHANGELOG/` son del flujo de memoria (`/record`, agente `summarizer`); el resto de la documentación es de quien cambia el fichero.
3. Ramas con nombre de feature. Los commits se **proponen**, nunca se empujan solos.

## Qué validar antes de dar por cerrada una tarea

```bash
npm test                # suite completa (ver abajo)
npm run lint:sh         # bash -n init.sh + scripts/check-memory-limits.sh
npm run lint:ps1        # parse AST de PowerShell sobre init.ps1
```

| Script | Qué ejecuta |
|---|---|
| `npm test` | `node --check init.mjs` + `test/run.mjs` (suite propia) + `.opencode/scripts/memory-rotate.test.mjs` + `.opencode/scripts/contract-tests.mjs` + `.opencode/scripts/version-check.mjs` |
| `npm run test:unit` | solo `test/run.mjs` |
| `npm run test:contract` | solo el contrato anti-drift |
| `npm run lint:sh` | `bash -n` de los scripts bash de la raíz |
| `npm run lint:ps1` | parse real con `[Parser]::ParseFile` (un grep no vale: un `.ps1` con error de sintaxis devuelve tokens de error) |
| `npm run version:check` | `package.json` == `init.mjs` / `init.sh` / `init.ps1` |
| `prepublishOnly` | `version:check` + contrato, automático antes de publicar |

La suite de `test/` es un micro-framework propio sin dependencias: `test/harness.mjs` (registro de casos, asserts, temporales), `test/fixtures.mjs` y `test/run.mjs`, que **ejecuta cada `test/*.test.mjs` en su propio proceso** (un `process.exit()` de un test no puede contaminar a los demás). Añade un `test/<area>.test.mjs` y el agregador lo descubre solo, sin editar nada más.

## Espejo raíz ↔ `templates/`

El contrato anti-drift (`.opencode/scripts/contract-tests.mjs`) compara **bytes**:

- Lo que existe en ambos lados debe ser **idéntico**, salvo lo que esté catalogado en `ALLOW_DIVERGENCE` (`AGENTS.md`, `.opencode/agents/advisor.md`, `.opencode/commands/doctor.md`, `.opencode/scripts/doctor.mjs`, `.opencode/skills/_project-docs/SKILL.md`, `opencode.json`, `.gitignore`, `PROJECT_STATE.md`, `SUMMARY.md`, `skills-lock.json`, `scripts/check-memory-limits.sh`).
- Un archivo **solo en la raíz sin catalogar rompe el contrato** (no avisa: falla). Si creas uno, o lo espejas en `templates/`, o lo declaras en `ROOT_ONLY_EXACT` / `ROOT_ONLY_PREFIXES` con su motivo.
- `test/` y `.github/` son desarrollo puro: nunca se instalan por proyecto ni se espejan.

Al tocar cualquier par, copia el fichero entero al otro lado en vez de editar los dos a mano: es la forma barata de que el hash siga coincidiendo.

## Dos notas de mantenimiento de la CI ( quirks deliberados, no son bugs)

1. **La `opencode.json` de la raíz está en `.gitignore` a propósito** (el patrón anclado `/opencode.json`; la pública es `templates/opencode.json`, que sí se trackea). Es config de desarrollo local, así que un checkout limpio de CI **no la trae**, y sin ella `doctor` marca `opencode.json` en error y `test/doctor.test.mjs` falla. Por eso `ci.yml` y `release.yml` siembran el fichero antes de correr la suite (`[ -f opencode.json ] || cp templates/opencode.json opencode.json`). Es un fichero de trabajo: nunca se commitea.

2. **En el runner de Windows, el `tar` de GNU va primero en el PATH.** Git for Windows pone su propio `tar` delante del `bsdtar` de System32, y el de GNU interpreta `C:` como un host remoto: el backup (que usa rutas absolutas al escribir sobre un destino con contenido) falla con rutas `C:\...`. El paso de segunda pasada `--upgrade` de `pack-smoke` antepone `/c/Windows/System32` al PATH para que resuelva el `tar` de Windows. Si añades un paso de CI que invoque `tar` en Windows, haz lo mismo.

Además, en la CI no se activa `cache: npm` a propósito: exigiría un lockfile y este repo no tiene ninguno.

## Publicación

- El tag `v<version>` tiene que coincidir con la versión de `package.json` (lo comprueba `release.yml`).
- `release.yml` invoca `ci.yml` con `workflow_call` y solo publica si pasan los cinco jobs; `npm publish --provenance` + GitHub Release con el tarball adjunto. Un `workflow_dispatch` con `dry-run` verifica sin publicar.
- `package.json` `files` = `init.sh`, `init.ps1`, `init.cmd`, `init.mjs`, `templates/`, `README.md`, `LICENSE`. Si añades algo al paquete, actualiza también la lista must-have del job `pack-smoke` y la aserción de `git archive`.
- `.gitattributes` marca con `export-ignore` lo que es desarrollo puro; sin eso, el zip de código de GitHub se lleva `.opencode/`, la memoria y los scripts.
