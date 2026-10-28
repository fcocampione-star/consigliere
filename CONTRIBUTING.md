# Contributing — consigliere / advisor-harness

Flujo de desarrollo del harness. Esto es un repo **sin dependencias**: no hay `package.json` con `dependencies`, ni lockfile, ni `npm ci`. Todo lo que se instala es código del propio repo.

## Requisitos

- **Node.js >= 20.11.0** (`.nvmrc` = 20). Es el suelo duro: el harness usa `import.meta.dirname`, disponible desde 20.11.
- Bash 4+ o PowerShell 5.1+ (solo para los lanzadores y los scripts de shell), `git` y `tar`.

## Antes de tocar nada

1. Lee `PROJECT_STATE.md` (capa 0 de la memoria, siempre). `SUMMARY.md` y `CHANGELOG/` solo si necesitas histórico.
2. Recuerda el reparto de la memoria: `PROJECT_STATE.md`, `SUMMARY.md` y `CHANGELOG/` son del flujo de memoria (`/record`, agente `summarizer`); el resto de la documentación es de quien cambia el fichero.
3. Ramas con nombre de feature. Los commits se **proponen**, nunca se empujan solos.

## Política de ramas

- `dev` es la rama de **integración** y `main` la rama **estable**: **ambas son el repo completo** (`test/`, `.github/`, `scripts/`, `CONTRIBUTING.md`, `.nvmrc` y los dev-tools). No hay proyección por contenido: `main` **no se regenera** desde `dev`.
- Las ramas feature/bug salen de `dev` y mergean a `dev`.
- La promoción `dev`→`main` es **`--ff-only`** (fast-forward): `main` queda idéntico a `dev`. Si no es fast-forward, `main` se movió por su cuenta y hay que revisarlo antes de tocar nada.
- El canal de consumo limpio no es una rama: es el paquete **npm** (`files` de `package.json`) y el **source archive del tag** de GitHub (`export-ignore` de `.gitattributes`).

## Qué validar antes de dar por cerrada una tarea

> ⚠️ **Primer arranque de un clon: `npm install && npm run dev:config` ANTES de `npm test`.** La `opencode.json` de la raíz está gitignored y `doctor` ya **no** cae a `templates/opencode.json` (config raíz = prerequisito duro): sin ese fichero un clon limpio da `doctor` ❌ y `test/doctor.test.mjs` falla. **El orden importa:** primero `dev:config` (crea el fichero), y solo después `routine-model.mjs --persist` (que edita ese mismo fichero); al revés, `routine-model` caería a `.opencode/opencode.json` — no ignorado — y rompería el contrato.

```bash
npm run dev:config      # prerequisito: genera la opencode.json dev (gitignored)
npm test                # suite completa (ver abajo)
npm run lint:sh         # bash -n init.sh + scripts/check-memory-limits.sh
npm run lint:ps1        # parse AST de PowerShell sobre init.ps1
```

| Script | Qué ejecuta |
|---|---|
| `npm test` | `node --check init.mjs` + `test/run.mjs` (suite propia) + `.opencode/scripts/memory-rotate.test.mjs` + `.opencode/scripts/contract-tests.mjs` + `.opencode/scripts/version-check.mjs` |
| `npm run test:unit` | solo `test/run.mjs` |
| `npm run test:contract` | solo el contrato anti-drift |
| `npm run dev:config` | genera la `opencode.json` dev local (gitignored) desde `templates/opencode.json` (`{{MODEL_*}}` → `""`); `--check` asserta frescura, `--force` regenera; sin flags es no-op si existe |
| `npm run lint:sh` | `bash -n` de los scripts bash de la raíz |
| `npm run lint:ps1` | parse real con `[Parser]::ParseFile` (un grep no vale: un `.ps1` con error de sintaxis devuelve tokens de error) |
| `npm run version:check` | `package.json` == los 5 destinos: `init.mjs` / `init.sh` / `init.ps1` + las 2 `_project-docs/SKILL.md` |
| `npm run version:bump` | sube la versión en los 5 destinos y en `package.json` (`patch`/`minor`/`major` o `--set X.Y.Z`); `--dry-run` no escribe |
| `prepublishOnly` | `version:check` + contrato, automático antes de publicar |

La suite de `test/` es un micro-framework propio sin dependencias: `test/harness.mjs` (registro de casos, asserts, temporales), `test/fixtures.mjs` y `test/run.mjs`, que **ejecuta cada `test/*.test.mjs` en su propio proceso** (un `process.exit()` de un test no puede contaminar a los demás). Añade un `test/<area>.test.mjs` y el agregador lo descubre solo, sin editar nada más.

## Espejo raíz ↔ `templates/`

El contrato anti-drift (`.opencode/scripts/contract-tests.mjs`) compara **bytes**:

- Lo que existe en ambos lados debe ser **idéntico**, salvo lo que esté catalogado en `ALLOW_DIVERGENCE` (`AGENTS.md`, `.opencode/agents/advisor.md`, `.opencode/commands/doctor.md`, `.opencode/scripts/doctor.mjs`, `.opencode/skills/_project-docs/SKILL.md`, `opencode.json`, `PROJECT_STATE.md`, `SUMMARY.md`, `skills-lock.json`, `scripts/check-memory-limits.sh`).
- Un archivo **solo en la raíz sin catalogar rompe el contrato** (no avisa: falla). Si creas uno, o lo espejas en `templates/`, o lo declaras en `ROOT_ONLY_EXACT` / `ROOT_ONLY_PREFIXES` con su motivo. Dev-only ya catalogados: `lint-sh.mjs` (resuelve el intérprete bash) y `dev-config.mjs` (genera el config dev de la raíz).
- `test/` y `.github/` son desarrollo puro: nunca se instalan por proyecto ni se espejan.
- `templates/gitignore` es un caso especial: npm **excluye del tarball** cualquier fichero llamado `.gitignore` (lo trata como ignore-file), así que la plantilla se guarda sin el punto y `init.mjs` (`TEMPLATE_RENAME`) la restituye a `.gitignore` en el proyecto. Por eso `.gitignore` (raíz) está en `ROOT_ONLY_EXACT` y `gitignore` en `TEMPLATE_ONLY_EXACT`, y **no** son un par espejo.

Al tocar cualquier par, copia el fichero entero al otro lado en vez de editar los dos a mano: es la forma barata de que el hash siga coincidiendo.

## Este repo es el ORIGEN, no un consumidor: no lo apuntes con el instalador

> El flujo de un proyecto **consumidor** (harness+memoria en la raíz de su repo, compartidos, y exclusión solo del artefacto de release) se documenta en README › "Equipo: un repo, un harness + memoria compartidos".

Los ficheros de la raíz que **no** son copia de `templates/` (`.opencode/`, `AGENTS.md`, la variante de desarrollo de `doctor.mjs`, `contract-tests.mjs`, `version-check.mjs`, `version-bump.mjs`, `test/`) divergen de la plantilla **a propósito**, y esa divergencia está catalogada en la allowlist del espejo (`ALLOW_DIVERGENCE` / `ROOT_ONLY_EXACT` de `contract-tests.mjs`). Por eso el instalador **nunca** debe recibir la ruta de este repo: un `--upgrade` contra aquí regenera desde `templates/` lo que no es una copia y lo sustituye por la versión genérica de la plantilla — el `AGENTS.md` con la tabla de stack real, el `doctor.mjs` de desarrollo, el doc del comando `/doctor`, la skill `_project-docs`, el `.gitignore`, `scripts/check-memory-limits.sh`. Además se crea `.advisor/backups/` con el backup previo y una `opencode.json` generada en la raíz, y el `.gitignore` regenerado es el de la plantilla, que **no lleva la línea `/opencode.json`** (esa solo existe en el de la raíz) ni las de `.advisor/memory-manifest.json` y `.advisor/chunks/`: el config local y el estado vivo derivado dejan de estar ignorados y un `git add -A` se los lleva al commit. Los backups sí los ignora la plantilla (`.advisor/backups/`), pero aparecen igualmente en tu working tree.

El instalador se defiende: `isHarnessSource` + `refuseHarnessSource` (`init.mjs`) detectan el caso (destino con `templates/.opencode`, `init.mjs` y un `package.json` cuyo `name` sea el del paquete del harness) y **se niegan con exit 2** sin escribir nada. Con `--force` avisa en voz alta y continúa (el backup previo sigue siendo obligatorio: es la única red). Los dos caminos están cubiertos en `test/init.test.mjs`.

**Para ensayar una instalación, en un temporal y nunca aquí:**

```bash
node init.mjs /tmp/demo --autoskills 3 --git no              # install limpio (no interactivo)
node init.mjs /tmp/demo --upgrade --autoskills 3 --git no   # la segunda pasada
```

(`/tmp/demo` = cualquier ruta vacía fuera del repo; en Windows, `%TEMP%\demo`.) Instala en ese directorio, haz el `--upgrade` contra ese proyecto temporal, y lee el resultado ahí. Si lo que quieres probar es el repo en sí, usa `npm test` y el contrato anti-drift, que es la comprobación de la divergencia.

> Recordatorio de la nota 1 de abajo: la `opencode.json` de la raíz está en `.gitignore` **a propósito** — es la config de desarrollo local, nunca se commitea — y por eso `ci.yml` y `release.yml` la generan con `npm run dev:config` antes de correr la suite. En local, `npm run dev:config` es el prerequisito del primer arranque.

## Dos notas de mantenimiento de la CI ( quirks deliberados, no son bugs)

1. **La `opencode.json` de la raíz está en `.gitignore` a propósito** (el patrón anclado `/opencode.json`; la pública es `templates/opencode.json`, que sí se trackea). Es config de desarrollo local, así que un checkout limpio de CI **no la trae**, y sin ella `doctor` marca `opencode.json` en error — ya **sin** fallback a la plantilla — y `test/doctor.test.mjs` falla. Por eso `ci.yml` y `release.yml` la generan con `npm run dev:config` (misma forma de invocación que documenta este archivo) antes de correr la suite; en local el prerequisito del primer arranque es `npm install && npm run dev:config`. Es un fichero de trabajo: nunca se commitea.

2. **En el runner de Windows, el `tar` de GNU va primero en el PATH.** Git for Windows pone su propio `tar` delante del `bsdtar` de System32, y el de GNU interpreta `C:` como un host remoto: el backup (que usa rutas absolutas al escribir sobre un destino con contenido) falla con rutas `C:\...`. Por eso `init.mjs` resuelve el tar internamente (`ADVISOR_TAR` → `System32\tar.exe` en win32 → `tar` del PATH) y lo usa en todos sus call-sites; el workflow ya **no** antepone `/c/Windows/System32` al PATH. Si añades un paso de CI que invoque `tar` por su cuenta en Windows, resuélvelo igual.

Además, en la CI no se activa `cache: npm` a propósito: exigiría un lockfile y este repo no tiene ninguno.

## Publicación

**Runbook (orden exacto, sin atajos):**

1. En `dev`: `npm run version:bump patch` (o `minor`/`major`; primera vez en una rama, `--dry-run` para revisar la tabla). Reescribe los 5 destinos + `package.json` y no toca git.
2. `npm test` en verde (incluye `version:check` y el contrato anti-drift). Commit y push del bump a `dev`.
3. `git switch main && git merge --ff-only dev && git push origin main`. La promoción es **solo** fast-forward: si `--ff-only` falla, `main` se movió por su cuenta y hay que investigarlo, no forzar el merge.
4. `git tag vX.Y.Z` sobre el commit que **ya** está en `origin/main` (`git rev-parse main origin/main` tienen que coincidir) y `git push origin vX.Y.Z`. El push del tag dispara `release.yml`.

Detalles que el workflow comprueba y que conviene no olvidar:

- El publish se origina desde **`main`**: `release.yml` verifica que el commit del tag es ancestro de `origin/main` (con `fetch-depth: 0` + `git merge-base --is-ancestor`) y que el tag coincide con la versión de `package.json`.
- `release.yml` invoca `ci.yml` con `workflow_call` y solo publica si pasan los cinco jobs; `npm publish --provenance` + GitHub Release con el tarball adjunto. El publish usa **npm Trusted Publishing (OIDC)**: sin `NPM_TOKEN` ni secretos, con `id-token: write`, npm >= 11.5.1 y `setup-node` sin `registry-url`; el Trusted Publisher (repo + `release.yml`) se configura en npmjs.com. Un `workflow_dispatch` con `dry-run` verifica sin publicar.
- **`release.yml` no valida que `main` esté al día con `dev`**: comprueba que el tag está sobre `main` y que la versión coincide, no que `main` contenga lo último de `dev`. Si te saltas el paso 3 y taggeas sobre un `main` atrasado, el release publica un árbol incompleto sin que la guarda lo detecte: el orden de arriba no es ceremonia, es la única red.
- Si `advisor-harness@X.Y.Z` ya existe en npm (tag re-ejecutado) el publish se omite con un `::notice::`; la release de GitHub es idempotente (`gh release view || gh release create`). Un error del `npm view` que no sea `E404` (red, 5xx, `ENEEDAUTH`) **falla** el workflow en vez de convertirse en skip. La verificación post-publish **no** se salta en los reruns (verifica el estado final del registry, no la suposición de que el otro run acertó) y reintenta hasta ~5 min (10 intentos × 30 s, `--prefer-online`) hasta que la versión y `dist-tags.latest` coincidan; el registry tarda ~2-3 min en servir lo recién publicado (run 39656624120: E404 a los 3 s con el publish ya hecho). Re-ejecutar el run de un tag **histórico** (p. ej. 1.0.2) falla esa aserción a propósito: `latest` ya apunta a otra versión.
- **Colas de runners macOS:** pueden cancelar el gate antes de arrancar. La mitigación es operativa, no de cobertura: los runs son **idempotentes** (skip-if-published) y se recuperan con `gh run rerun --failed <run-id>` sin republicar ni tocar `latest`; los `timeout-minutes` (`ci.yml` 20 por job, `release.yml` 30 en `publish`) acotan cuelgues de ejecución, **no** el tiempo en cola — un job esperando runner no consume ese límite. Publicar en npm es inmutable, así que no se recorta la matriz ni se añade `continue-on-error` para hacerlo pasar.
- `prepublishOnly` **no** corre con `npm publish <tarball>` (el workflow publica el tarball que antes empaquetó), así que la cobertura son los steps del workflow, no el hook.
- `package.json` `files` = `init.sh`, `init.ps1`, `init.cmd`, `init.mjs`, `templates/`, `README.md`, `LICENSE`. Si añades algo al paquete, actualiza también la lista must-have del job `pack-smoke` y la aserción de `git archive`.
- `.gitattributes` marca con `export-ignore` lo que es desarrollo puro; sin eso, el zip de código de GitHub se lleva `.opencode/`, la memoria y los scripts.
