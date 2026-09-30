# Consigliere 2.0 (Advisor Harness) — Harness de agentes + memoria persistente para opencode

> **Solo por proyecto.** Un scaffold reutilizable que deja cada proyecto listo para trabajar con opencode: agentes orquestados, memoria que recuerda decisiones entre sesiones y comandos para auditar, registrar y revisar el progreso. Sin binarios globales, sin servicios: es Markdown + scripts que se instalan **dentro** del proyecto.

> **⚠️ Disponibilidad de `npx`:** la vía `npx advisor-harness@latest` requiere que el paquete esté publicado en npm (hito futuro, aún no publicado). **Hoy usa las instrucciones locales** (`git clone` + `node init.mjs` / `./init.sh` / `powershell -File init.ps1`). Cuando se publique, `npx` funcionará igual sin cambiar nada.

## Requisitos

- **Node.js >= 20.11.0** — obligatorio en **todas** las vías de instalación. Hay cuatro puntos de entrada: `init.mjs`, que es la única implementación, y tres lanzadores de ~20 líneas (`./init.sh`, `powershell -File init.ps1` e `init.cmd`) que la ejecutan a través de Node (`exec node .../init.mjs`). El suelo es 20.11 porque el harness usa `import.meta.dirname`; con menos, el instalador aborta con exit 1.
- `git` — recomendado: sin él se omite el `git init`, el hook post-commit y el commit inicial (aviso, no error).
- `tar` — obligatorio para el backup previo y para `--restore`. Sin él solo se puede instalar en un destino vacío.

## En 30 segundos

1. En una carpeta **vacía**, ejecuta (desde el clon del repo):

   ```bash
   node init.mjs          # o: ./init.sh  /  powershell -File init.ps1
   ```

   No necesitas responder nada: detecta que la carpeta está vacía y genera el harness directamente. Cero prompts, con un resumen de 3 líneas (destino, defaults aplicados — modelos heredados y sin stack — y opciones finales: autoskills omitido + git init).

2. Abre esa carpeta con `opencode`.

3. Escribe:
   `/discover` (revisa contexto y skills) → `/routine "configurar base del proyecto"` (planifica y ejecuta la tarea) → `/doctor` (verifica que todo está sano).

Ese es el día a día. Si tu carpeta **no está vacía**, el mismo comando abre un asistente que te guía (ver [Instalación](#instalación)).

## ¿Qué genera?

```
<proyecto>/
├── .opencode/
│   ├── agents/
│   │   ├── advisor.md             # agente primario que coordina (routing + spec-lite)
│   │   ├── explore.md             # audita contexto + skills (leaf, depth 2)
│   │   ├── planner.md             # diseña + spec Given/When/Then (≤650w)
│   │   ├── critic.md              # revisa decisiones de diseño
│   │   ├── builder.md             # implementa (bash harden)
│   │   ├── verifier.md            # typecheck/lint/tests
│   │   └── summarizer.md          # memoria 3 capas + topic upsert + session summary
│   ├── commands/
│   │   ├── discover.md            # /discover → audita contexto + skills
│   │   ├── routine.md             # /routine → explore→plan/spec→critic→build→verify→record
│   │   ├── modo.md                # /modo → fijar modo de comunicación (educador/practicante/copiloto/auto)
│   │   ├── doctor.md              # /doctor → diagnóstico harness + memoria
│   │   ├── record.md              # /record → persistir progreso (6 campos)
│   │   ├── review.md              # /review → decisiones stale (review_after)
│   │   ├── rotate-memory.md       # rotación semanal manual
│   │   └── compact-state.md       # compactar PROJECT_STATE.md
│   ├── plans/                     # AGENT-PIPELINE.md, MEMORY-SYSTEM.md
│   ├── skills/
│   │   ├── _project-docs/         # plantilla de docs del stack
│   │   ├── _sdd-lite/             # spec-lite ≤650w Given/When/Then
│   │   └── _skill-loader/         # loader.mjs + SKILL.md (cache fingerprint en .advisor/)
│   ├── scripts/
│   │   ├── memory-index.mjs       # search/timeline/get (md+grep)
│   │   ├── memory-sync.mjs        # export/import chunks locales
│   │   ├── memory-lock.mjs        # lock de escrituras + umbrales
│   │   ├── memory-stats.mjs       # stats + extracción por secciones
│   │   ├── memory-rotate.mjs      # motor canónico de rotación
│   │   ├── routine-model.mjs      # overrides de modelo por agente
│   │   ├── lib/                   # core.mjs / md.mjs / cache.mjs (compartido, sin deps)
│   │   └── doctor.mjs             # health check
│   └── hooks/                     # post-commit-memory-rotate.sh (opcional/gated; no hay hook de sync)
├── .advisor/                      # estado VIVO del harness
│   ├── backups/                   # advisor-*.tgz keep 5 (backup previo a cualquier escritura)
│   ├── chunks/                    # memoria sync local (git-tracked opcional)
│   └── skill-registry.cache.json  # fingerprint cache v2
├── AGENTS.md                      # instrucciones raíz + stack + comandos dev
├── opencode.json                  # default_agent, modelos cheap vs strong, bash harden
├── PROJECT_STATE.md               # CAPA 0 — siempre cargada + review_after
├── SUMMARY.md                     # CAPA 1 — última semana + topic (on-demand)
├── CHANGELOG/                     # CAPA 2 — historial semanal archivado
├── scripts/                       # check-memory-limits.sh/.ps1 (límites 100/150)
├── .gitignore
└── skills-lock.json
```

> **Repo público ≠ proyecto instalado.** En este repositorio, `opencode.json`, `skills-lock.json`, `scripts/`, `test/`, `.github/` y la memoria (`PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`, `.advisor/`) quedan **fuera del paquete público** (`package.json` `files`: `init.sh`, `init.ps1`, `init.cmd`, `init.mjs`, `templates/`, `README.md`, `LICENSE`; `export-ignore` en `git archive`). Salvo `test/` y `.github/`, **todo lo anterior sí se genera** en cada proyecto que instalas: el árbol de arriba es lo que obtiene el proyecto, no lo que se publica en npm. Los dos excluidos son de desarrollo de este repo —la suite propia y los workflows de CI— y no se instalan en ningún proyecto. `.advisor/` tampoco viene de `templates/`: lo crea el instalador en caliente como estado vivo (backups, chunks, cache).

## Instalación

Tres caminos, todos 100% por proyecto. El instalador decide solo: carpeta vacía → genera directo; carpeta con archivos → asistente.

### Camino simple: happy path (0 prompts)

```bash
git clone https://github.com/fcocampione-star/consigliere.git && cd <carpeta-del-clon>  # por defecto: consigliere
node init.mjs            # en una carpeta vacía: genera directo, sin preguntar nada
```

- Defaults: modelos heredados (sin asignar), sin stack, autoskills omitido (3), `git init` + commit.
- CI-safe: no lee de stdin, apto para pipelines.
- Mismo comportamiento en los tres lanzadores (`./init.sh`, `powershell -File init.ps1` e `init.cmd`): ejecutan `init.mjs` con Node, así que el CLI, los flags y los códigos de salida son los mismos.

**Forzar happy path en cualquier carpeta** (aunque no esté vacía): `--quick` / `-y`. Respeta `--dir <ruta>` o la ruta posicional como destino; si no hay, usa la carpeta actual:

```bash
node init.mjs --quick
node init.mjs -y /ruta/proyecto
node init.mjs --quick --dir /ruta/proyecto
```

### Camino guiado: asistente interactivo

Sin ruta por adelantado: pregunta `📁 Ruta → Nombre → Stack → Modelos → Autoskills → Git`.

```bash
git clone https://github.com/fcocampione-star/consigliere.git
cd consigliere
node init.mjs            # cwd con archivos → asistente (o fuerza con --interactive/-i)
./init.sh                # macOS/Linux/Git Bash
powershell -File init.ps1    # Windows
init.cmd                     # CMD
```

- **`--interactive` / `-i`**: fuerza el asistente aunque la carpeta esté vacía.
- **Stack** (opcional, Enter = saltar): base de datos, backend, frontend, auth, validación, deploy — pre-rellena `AGENTS.md` y `SKILL.md`.
- **Modelos**: un solo prompt — `¿Modelos por defecto (heredar todos)? [recomendado]/personalizar`. Si eliges *personalizar*, los 7 modelos se piden en una línea, coma-separados, en orden `advisor,planner,builder,critic,verifier,summarizer,explore` (vacío = heredar). Ya no hay 7 preguntas separadas.
- Descarga ZIP: descomprime → `cd <carpeta-del-zip>` (nombre de carpeta del ZIP, normalmente `consigliere-main`) → mismo comando de arriba.

### Camino avanzado: no-interactivo (CI / scripts)

```bash
# Mismo CLI que ofrecerá el paquete npm cuando se publique (hoy: desde el clon del repo)
node consigliere/init.mjs --dir /ruta/proyecto --name mi-app \
  --stack-db postgresql --stack-backend node/express --stack-frontend react/vite \
  --stack-auth jwt --stack-validation zod --stack-deploy docker \
  --autoskills 1 --git yes

# actualizar (backup completo keep 5 + preserva memoria/config; sin --force)
node consigliere/init.mjs --dir /ruta/proyecto --upgrade

# alcance modular: --upgrade monolítico = --part all
node consigliere/init.mjs --dir /ruta/proyecto --upgrade --part harness
node consigliere/init.mjs --dir /ruta/proyecto --upgrade --part memoria
node consigliere/init.mjs --dir /ruta/proyecto --upgrade --part autoskills

# estado read-only (no escribe) / restaurar backup (acepta advisor- y harness-)
node consigliere/init.mjs --dir /ruta/proyecto --status
node consigliere/init.mjs --dir /ruta/proyecto --restore --from .advisor/backups/advisor-<ts>.tgz

# desinstalar alcance de --part (pide confirmación sin --force; memoria exige backup previo + --force)
node consigliere/init.mjs --dir /ruta/proyecto --uninstall --part harness --force

# simular sin escribir nada / sobrescribir un destino no vacío sin harness (a tu riesgo)
node consigliere/init.mjs --dir /ruta/proyecto --dry-run
node consigliere/init.mjs --dir /ruta/proyecto --force
```

### Qué hace el instalador al escribir

Da igual por dónde entres (`install`, `--quick`, asistente o `--upgrade`), las reglas son las mismas:

- **Backup previo obligatorio** en `.advisor/backups/advisor-<ts>.tgz` (keep 5) antes de **cualquier escritura sobre un destino con contenido**, no solo en `--upgrade`. Cubre `.opencode/`, `AGENTS.md`, `PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`, `.advisor/`, `opencode.json`, `.gitignore`, `skills-lock.json` y los dos `scripts/check-memory-limits.*`. Si el backup falla, **no se escribe nada** y se sale con 4. Un destino sin nada previo que perder se sigue sin `tar`.
- **Se preservan** (se restauran del backup): `PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`.
- **Se regeneran** desde la plantilla: `AGENTS.md`, `opencode.json`, `.gitignore`. De `opencode.json` se conserva **solo** tu `agent.<nombre>.model` de cada agente que exista en ambos ficheros (nunca se inventa un agente ni se copia el resto de la config anterior); si la plantilla ya trae valor para ese agente —porque lo rellenó el asistente en esa misma corrida— manda la plantilla.
- **Nunca se sobrescribe**: `skills-lock.json` (tus pins de autoskills). Solo se crea si no existe.
- **Hook post-commit**: si ya existe, se copia a `.advisor/backups/hooks/post-commit.<ts>.bak` y **no** se sobrescribe salvo con `--force`. Si el repo fija `core.hooksPath`, avisa de que el hook puede no ejecutarse.
- **`--dry-run`**: no escribe nada y no imprime el banner de "proyecto listo" (nunca canta éxito de algo que no ocurrió).
- **`--uninstall`**: borra **rutas exactas**, nunca un directorio entero del usuario. Contra la plantilla se expanden los ficheros del harness de `.opencode/`; `scripts/` solo aporta sus dos `check-memory-limits.*` (lo que tengas ahí se queda), y si tienes un agente o plugin propio dentro de `.opencode/` el directorio no se borra: solo se retiran los directorios que queden vacíos. `.git` nunca se toca.

### Códigos de salida

Contrato estable (`init.mjs` `EXIT`, documentado en `--help`):

| Código | Significado |
|--------|-------------|
| 0 | ok |
| 1 | uso o validación: flag desconocido, valor fuera de dominio, falta `--part`, destino no vacío sin `--force`, `--upgrade` sin harness previo, Node < 20.11 |
| 2 | hace falta confirmación y no la hubo: sesión no interactiva donde se requería, o confirmación rechazada |
| 3 | falta una dependencia requerida (`tar` para el backup previo, `--upgrade`, `--restore` o `--uninstall memoria`/`--uninstall all`) |
| 4 | falló el backup o la restauración con `tar` (el backup previo nunca se descarta) |
| 5 | fallo parcial: se escribió algo y un paso posterior falló |

### Ayuda por capas

`--help` / `-h` muestra primero un **Uso rápido** de 3 líneas (el 90% de los casos) y después el **Uso avanzado**: operaciones (`--upgrade`, `--status`, `--restore`, `--uninstall`, `--dry-run`, `--force`), flags completos, qué genera y el flujo recomendado.

## Compatibilidad rename (consigliere → Advisor)

- **Display**: `Advisor`; **npm**: `advisor-harness` (`npx advisor-harness@latest`); **bin**: `advisor`, `advisor-harness` + alias `consigliere-harness` (1 versión de transición).
- **Publicación**: `advisor-harness` nuevo + `consigliere-harness@final` como shim (warning + exec `advisor-harness`) con `npm deprecate` apuntando al nuevo nombre.
- **Repo**: `https://github.com/fcocampione-star/consigliere.git`.
- **Estado vivo**: solo `.advisor/` (backups, chunks, cache). Sin directorios legacy.
- **Backups**: nuevos `advisor-<ts>.tgz`; restore/prune aceptan `^(harness|advisor)-` (keep 5 combinado). Skill-cache v2 (`refresh --force` invalida v1).
- **Se preserva a propósito**: historial `SUMMARY.md`/`CHANGELOG/`, autor git `CONSIGLIERE` + email `consigliere@local`, `installed_by: consigliere` en `skills-lock.json`.
- **Seguridad uninstall**: sin `--force` pide confirmación; la memoria (`PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`) se borra con `--part memoria` **y también con `--part all`**, que es la unión de los tres alcances — en ambos casos hace falta `--force` y un backup previo obligatorio con copia externa fuera del proyecto (aborta con 4 si falla); borrado solo de rutas listadas explícitamente, nunca `.git`; mantiene harden bash (`deny` irreparable + `ask` sensibles).

## Flujo de trabajo en cada proyecto

1. **cd** al proyecto generado.
2. Completa `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md`.
3. Opcional: asigna modelos por agente en `opencode.json` (raíz; `cheap`=verifier/summarizer/explore, `strong`=builder/planner/critic). Si un modelo del free tier falla, ver [Modelos del free tier: "can only be used from within OpenCode"](#modelos-del-free-tier-can-only-be-used-from-within-opencode).
4. `npm install && npx autoskills` (si `package.json` existe).
5. En opencode: `/discover` → `/routine "configurar base del proyecto"` → `/doctor` para verificar.

### Modelos del free tier: "can only be used from within OpenCode"

Si opencode responde `Error: OpenCode's free tier can only be used from within OpenCode`, **no es un fallo del harness**. Es una comprobación de opencode: rechaza servir sus modelos del free tier cuando la petición no viene del propio cliente, porque exige un `User-Agent` con la forma `opencode/<semver>` y la cabecera `x-opencode-session`. Está activa desde el 2026-09-17, se sigue en los issues upstream 49433, 49580 y 49590, y seguía presente en la última release (1.18.33). Cualquier cliente que no sea el cliente de opencode —un runner, un proxy, un editor que hable con su API— se queda fuera.

Qué hacer (las dos, y solo dos):

1. **Usar un modelo que no sea del free tier** para el agente `advisor` en `opencode.json`.
2. **Renovar la entitlement**: `opencode auth login`.

Lo que **no** es una solución: el harness solo valida la *forma* de un id de modelo (`^[A-Za-z0-9._:\/-]{1,80}$`, en `routine-model.mjs` y en el instalador); no puede saber si ese id tiene derecho a usarse, así que el error lo emite opencode, no ninguna validación nuestra. **No es algo que se pueda resolver dentro del harness, y ningún código de este repositorio intenta saltarse la comprobación**: falsificar cabeceras o la identidad de cliente para colar la petición sería esquivar una decisión de opencode, no arreglar un fallo. Si necesitas un modelo del free tier, pasa por `opencode auth login`.

### Comandos del harness

- `/discover [foco]` — audita stack real vs declarado + skills presentes/faltantes.
- `/routine <tarea> [--parallel --skip-verify --skip-critic]` — enruta la tarea por sí solo: pocos archivos → directo; muchos → delega en subagentes (plan → revisión → implementación → verificación → registro). Para los detalles técnicos, ver *Notas de diseño v2.0*.
- `/doctor` — diagnóstico del harness y la memoria: `opencode.json` (default agent, profundidad, harden bash), tamaños y `topic:` de la memoria, lock huérfano, hook post-commit, cache de skills, scripts, directorios de estado y artefactos derivados (manifest, índice, `review_after` vencidos). Los artefactos regenerables son ℹ️ y nunca rompen; el exit code es 0 (ok), 1 (warnings) o 2 (errores).
- `/record <contexto>` — persiste con formato 6 campos `Goal/Discoveries/Accomplished/Next/Files/Verificación` (compat `Qué/Verificación`).
- `/review` — lista decisiones stale (`review_after` +90d).
- `/rotate-memory` — rotación semanal manual.
- `/compact-state` — compacta `PROJECT_STATE.md` §2 (dedup + archive).
- `/modo <educador|practicante|copiloto|auto>` — fija el modo de comunicación del advisor (session-scoped, no persiste en memoria; sin arg muestra el actual).

## Sistema de memoria (3 capas, inspirado Engram pero md+grep)

| Capa | Archivo | Carga | Contenido |
|------|---------|-------|-----------|
| 0 | `PROJECT_STATE.md` | siempre | fase, decisiones + `review_after`, patrones, pendientes (<100 líneas) |
| 1 | `SUMMARY.md` | on-demand | última semana + `topic: family/kebab` + índice (<150 líneas) |
| 2 | `CHANGELOG/YYYY-MM-DD.md` | rare | historial semanal (lunes) + `DECISIONS-ARCHIVE.md` |

- **Topic upsert**: `topic: architecture/auth-model` 2 niveles; mismo topic → upsert no duplicado.
- **Búsqueda progresiva (md+grep, cero dependencias)**: `node .opencode/scripts/memory-index.mjs search "query"` → IDs, `timeline <id>`, `get <id>`. No hay base de datos detrás: `search` hace coincidencia de **subcadena sin distinguir mayúsculas** sobre el título, el resumen y el `topic` de cada entrada (no es una regex), ordena los hits por relevancia (recencia + `topic` + título) y `get` devuelve el cuerpo de la entrada.
- **Rotación**: canónica en `/record` vía el motor Node `.opencode/scripts/memory-rotate.mjs` (dispara por lunes o `contentLines` > 150, con dedup + §4). El hook `post-commit` es un **backup opcional/gated** (`ADVISOR_ROTATE_HOOK=1`, desactivado por defecto). Sin `flock`: el lock canónico es `memory-lock.mjs`, y lo toman por igual las rutas que mutan la memoria (`rotate`, `migrate-markers` y `memory-sync export/import`), no solo el CLI.
- **Sync local**: `node .opencode/scripts/memory-sync.mjs export` → `.advisor/chunks/<monday>.json` (git-tracked), `import` restaura en clone.
- **Session summary**: 6 campos `Goal/Discoveries/Accomplished/Next/Files/Verificación`.
- **Stale**: `/review` lista `needs_review` si `review_after` pasado.

## Skills

```bash
node .opencode/skills/_skill-loader/loader.mjs list
node .opencode/skills/_skill-loader/loader.mjs search "query"
node .opencode/skills/_skill-loader/loader.mjs chunk "<skill>" urls,shortcuts,examples
node .opencode/scripts/memory-index.mjs search "auth middleware"
node .opencode/scripts/doctor.mjs
node .opencode/scripts/memory-sync.mjs export --all
```

Cache fingerprint: `.advisor/skill-registry.cache.json` (v2: `path+mtime+size`), refresh con `loader.mjs refresh --force`.

## Estructura de este repositorio

```
consigliere/
├── init.mjs                # instalador Node universal — ÚNICA implementación
├── init.sh                 # lanzador bash: exec node init.mjs "$@"
├── init.ps1                # lanzador PowerShell: & node init.mjs @args
├── init.cmd                # lanzador CMD: init.ps1 %*
├── templates/              # {{VAR}} + scripts + skills (lo que se instala en cada proyecto)
├── package.json            # publica en npm como `advisor-harness` (se consume con `npx advisor-harness@latest`)
├── README.md + LICENSE     # incluidos en el paquete publicado (files: init.* + templates/ + README + LICENSE)
├── CONTRIBUTING.md         # flujo de desarrollo y notas de mantenimiento
├── .nvmrc                  # Node de desarrollo: 20
├── test/                   # suite propia (harness sin dependencias + fixtures + agregador)
└── .github/workflows/      # ci.yml (5 jobs) + release.yml (gatea en CI)
```

> Ficheros de desarrollo **fuera** del paquete y del `git archive` (`export-ignore`): `opencode.json`, `skills-lock.json`, `scripts/`, `.opencode/` raíz, `.advisor/`, `AGENTS.md`, memoria y `test/`. Todo eso **sí se genera en cada proyecto instalado** salvo `test/`, que es la suite de desarrollo de este repo y no se instala en ningún proyecto.

## Dependencias

| Vía | Requeridas | Opcionales / notas |
|---|---|---|
| `init.mjs` | `node >=20.11.0` (usa `import.meta.dirname`; por debajo, exit 1) | `git` (sin él se omite `git init` + hook, con aviso) · `tar` (backup previo y `--restore`) |
| `init.sh` | `bash 4+` y **`node >=20.11.0`** (delega en `init.mjs`; sin Node, exit 3) | `git` · `tar` |
| `init.ps1` | `PowerShell 5.1+` y **`node >=20.11.0`** (delega en `init.mjs`; sin Node, exit 3) | `git` · `tar` |
| `init.cmd` | `init.ps1` + `node >=20.11.0` | — |

## Validación y CI

El repo tiene su propia suite, sin dependencias externas (nada de `npm ci`: no hay lockfile porque no hay paquetes).

| Script | Qué hace |
|---|---|
| `npm test` | `node --check init.mjs` + suite de `test/` + tests de rotación + contrato anti-drift + `version:check` |
| `npm run test:unit` | solo la suite de `test/` (micro-framework sin deps, un archivo por proceso hijo) |
| `npm run test:contract` | contrato anti-drift: paridad espejo raíz↔`templates/`, catálogos de archivos solo-raíz **y solo-template** (los dos fallan), invariantes, `node --check` derivado |
| `npm run lint:sh` | `bash -n` de `init.sh` y `scripts/check-memory-limits.sh` |
| `npm run lint:ps1` | parse real con el AST de PowerShell sobre `init.ps1` |
| `npm run version:check` | la versión de `package.json` aparece en `init.mjs`, `init.sh`, `init.ps1` y en las 2 copias de `_project-docs/SKILL.md` |
| `prepublishOnly` | `version:check` + contrato, antes de publicar |

`.github/workflows/ci.yml`, cinco jobs:

1. **syntax-and-tests** — `node --check` sobre cada `.mjs` del repo (recuento visible) + `npm test`, en matriz **3 SO (ubuntu/windows/macos) x Node 20/22/24**.
2. **shell-and-powershell** — `bash -n` de los 5 `.sh`, `shellcheck -S warning` (solo Linux) y parseo AST de PowerShell de los 3 `.ps1`.
3. **memory-limits** — `check-memory-limits.sh` en Linux y `.ps1` en Windows, más una aserción de **paridad**: las dos variantes tienen que mirar las mismas tres cosas (`PROJECT_STATE.md`, `SUMMARY.md`, `memory-manifest.json`).
4. **drift-and-packaging** — `templates/opencode.json` trackeada y la de raíz ignorada, `version:check`, bit `100755` en todo `.sh` trackeado, `git archive` sin rutas de desarrollo, `templates/opencode.json` presente en el tar y contrato anti-drift.
5. **pack-smoke** — `npm pack`, lista must-have dentro del tarball, instalación del tarball en un directorio temporal, instalación del harness con el CLI no interactivo, `opencode.json` generado como JSON válido, ningún placeholder `{{...}}` sin resolver, doctor instalado en exit 0 y una segunda pasada `--upgrade` idempotente (3 SO).

`.github/workflows/release.yml` llama a `ci.yml` con `workflow_call` y solo publica (con `--provenance`) si todo lo anterior pasó; el tag `v<version>` tiene que coincidir con `package.json`.

## Notas de diseño v2.0 (detalle técnico)

- **Solo por proyecto**: cero `~/.local/bin`, cero `PATH`, cero drift.
- **Routing orgánico**: el advisor decide por **clase de riesgo** (esquema/auth/contrato/migración/irreversible/arquitectura → delegated/spec-lite; bajo riesgo y pocos files → direct), con el **conteo de files como desempate**. Sin burocracia en tareas pequeñas.
- **SDD-lite integrado en `routine`** (≤650w Given/When/Then), no 10 fases pesadas.
- **Modelos cheap vs strong**: `{{MODEL_*}}` en `opencode.json` — cheap=verifier/summarizer/explore, strong=builder/planner/critic. El harness valida la forma del id, nunca el derecho a usarlo (ver § *Modelos del free tier*).
- **Harden bash**: deny extendido `**/*.pem,**/*.key,**/.env*,~/.ssh/*,**/secrets/*`.
- **Memoria md+grep**: topic upsert + stale + sync local, cero dependencias (inspirada en Engram, sin su base de datos).
- **Ops**: `/doctor` + backup previo obligatorio keep 5 + `--upgrade` (preserva la memoria, regenera la config) + `--part/--status/--restore/--uninstall` modulares.
- **Rename**: display `Advisor`, npm `advisor-harness` (shim `consigliere-harness@final` + deprecate), estado vivo solo en `.advisor/`, cache v2 (ver § Compatibilidad rename).