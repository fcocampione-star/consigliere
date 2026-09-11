# ADVISOR 2.0 — Harness de agentes + memoria persistente para opencode

> **Solo por proyecto.** Un scaffold reutilizable que deja cada proyecto listo para trabajar con opencode: agentes orquestados, memoria que recuerda decisiones entre sesiones y comandos para auditar, registrar y revisar el progreso. Sin binarios globales, sin servicios: es Markdown + scripts que se instalan **dentro** del proyecto.

> **⚠️ Disponibilidad de `npx`:** la vía `npx advisor-harness@latest` requiere que el paquete esté publicado en npm (hito futuro, aún no publicado). **Hoy usa las instrucciones locales** (`git clone` + `node init.mjs` / `./init.sh` / `powershell -File init.ps1`). Cuando se publique, `npx` funcionará igual sin cambiar nada.

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
│   │   ├── record.md              # /record → persistir progreso (5 campos)
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
│   │   └── doctor.mjs             # health check
│   └── hooks/                     # post-commit-memory-rotate.sh + sync
├── .advisor/                      # estado VIVO del harness
│   ├── backups/                   # advisor-*.tgz completo keep 5 (upgrade; compat rename)
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

> **Repo público ≠ proyecto instalado.** En este repositorio, `opencode.json`, `skills-lock.json`, `scripts/` y la memoria (`PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`, `.advisor/`) quedan **fuera del paquete público** (`package.json` `files`: `init.*` + `templates/`; `export-ignore` en `git archive`). Todos ellos **sí se generan** en cada proyecto que instalas: el árbol de arriba es lo que obtiene el proyecto, no lo que se publica en npm.

## Instalación

Tres caminos, todos 100% por proyecto. El instalador decide solo: carpeta vacía → genera directo; carpeta con archivos → asistente.

### Camino simple: happy path (0 prompts)

```bash
git clone https://github.com/fcocampione-star/consigliere.git && cd <carpeta-del-clon>  # por defecto: consigliere
node init.mjs            # en una carpeta vacía: genera directo, sin preguntar nada
```

- Defaults: modelos heredados (sin asignar), sin stack, autoskills omitido (3), `git init` + commit.
- CI-safe: no lee de stdin, apto para pipelines.
- Mismo comportamiento en `./init.sh` y `powershell -File init.ps1`.

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

> `--upgrade` hace backup completo keep 5 (incluye `.opencode/`, `AGENTS.md`, `PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`, `.advisor/`, `opencode.json`, `.gitignore`, `skills-lock.json`, `scripts/`) y preserva memoria/config (`PROJECT_STATE.md`, `SUMMARY.md`, `opencode.json`, `AGENTS.md`, `.gitignore`). Si el backup falla, aborta.

### Ayuda por capas

`--help` / `-h` muestra primero un **Uso rápido** de 3 líneas (el 90% de los casos) y después el **Uso avanzado**: operaciones (`--upgrade`, `--status`, `--restore`, `--uninstall`, `--dry-run`, `--force`), flags completos, qué genera y el flujo recomendado.

## Compatibilidad rename (consigliere → Advisor)

- **Display**: `Advisor`; **npm**: `advisor-harness` (`npx advisor-harness@latest`); **bin**: `advisor`, `advisor-harness` + alias `consigliere-harness` (1 versión de transición).
- **Publicación**: `advisor-harness` nuevo + `consigliere-harness@final` como shim (warning + exec `advisor-harness`) con `npm deprecate` apuntando al nuevo nombre.
- **Repo**: `https://github.com/fcocampione-star/consigliere.git`.
- **Estado vivo**: solo `.advisor/` (backups, chunks, cache). Sin directorios legacy.
- **Backups**: nuevos `advisor-<ts>.tgz`; restore/prune aceptan `^(harness|advisor)-` (keep 5 combinado). Skill-cache v2 (`refresh --force` invalida v1).
- **Se preserva a propósito**: historial `SUMMARY.md`/`CHANGELOG/`, autor git `CONSIGLIERE` + email `consigliere@local`, `installed_by: consigliere` en `skills-lock.json`.
- **Seguridad uninstall**: sin `--force` pide confirmación; memoria solo con `--part memoria` (+ `--force`) y backup previo obligatorio (aborta si falla); borrado solo de rutas listadas explícitamente, nunca `.git`; mantiene harden bash (`deny` irreparable + `ask` sensibles).

## Flujo de trabajo en cada proyecto

1. **cd** al proyecto generado.
2. Completa `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md`.
3. Opcional: asigna modelos por agente en `opencode.json` (raíz; `cheap`=verifier/summarizer/explore, `strong`=builder/planner/critic).
4. `npm install && npx autoskills` (si `package.json` existe).
5. En opencode: `/discover` → `/routine "configurar base del proyecto"` → `/doctor` para verificar.

### Comandos del harness

- `/discover [foco]` — audita stack real vs declarado + skills presentes/faltantes.
- `/routine <tarea> [--parallel --skip-verify --skip-critic]` — enruta la tarea por sí solo: pocos archivos → directo; muchos → delega en subagentes (plan → revisión → implementación → verificación → registro). Para los detalles técnicos, ver *Notas de diseño v2.0*.
- `/doctor` — diagnóstico: `opencode.json`, memoria `<100/<150`, hook, lock huérfano, skills.
- `/record <contexto>` — persiste con formato 5 campos `Goal/Discoveries/Accomplished/Next/Files` (compat `Qué/Verificación`).
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
- **Búsqueda progresiva (sin SQLite)**: `node .opencode/scripts/memory-index.mjs search "query"` → IDs, `timeline <id>`, `get <id>` (grep+perl; `sqlite3` solo si está instalado).
- **Rotación**: automática `post-commit` (lunes o >150 líneas) + `flock` + `.memory-lock`.
- **Sync local**: `node .opencode/scripts/memory-sync.mjs export` → `.advisor/chunks/<monday>.json` (git-tracked), `import` restaura en clone.
- **Session summary**: 5 campos `Goal/Discoveries/Accomplished/Next Steps/Files`.
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

Cache fingerprint: `.advisor/skill-registry.cache.json` (mtime+size), refresh con `loader.mjs refresh --force`.

## Estructura de este repositorio

```
advisor/
├── init.sh                 # instalador bash solo proyecto
├── init.ps1                # instalador PowerShell solo proyecto
├── init.cmd                # shim CMD → init.ps1
├── init.mjs                # instalador Node universal (o `npx` cuando esté publicado)
├── package.json            # publica en npm como `advisor-harness` v2.0.0 (files: init.* + templates/)
└── templates/              # plantillas {{VAR}} + scripts + cache (lo único que se publica, junto a init.*)
```

> Los ficheros de desarrollo de este repo (`opencode.json`, `skills-lock.json`, `scripts/`, `.opencode/` raíz, `.advisor/`, memoria) quedan fuera del paquete y del `git archive` (`export-ignore`), pero **se generan completos en cada proyecto instalado**.

## Dependencias

| Instalador | Requeridas | Opcionales |
|---|---|---|
| `init.mjs` (node) | `node 18+`, `git`, `tar` (requerido para `--upgrade`) | — |
| `init.sh` | `bash 4+`, `coreutils`, `git`, `tar` (requerido para `--upgrade`) | `node` (autoskills) |
| `init.ps1` | `PowerShell 5.1+`, `git`, `tar` (requerido para `--upgrade`) | `node` (autoskills) |

## Notas de diseño v2.0 (detalle técnico)

- **Solo por proyecto**: cero `~/.local/bin`, cero `PATH`, cero drift.
- **Routing orgánico**: el advisor decide por tamaño — 1-3 files direct vs 4+ delegated (subagentes). Sin burocracia en tareas pequeñas.
- **SDD-lite integrado en `routine`** (≤650w Given/When/Then), no 10 fases pesadas.
- **Modelos cheap vs strong**: `{{MODEL_*}}` en `opencode.json` — cheap=verifier/summarizer/explore, strong=builder/planner/critic.
- **Harden bash**: deny extendido `**/*.pem,**/*.key,**/.env*,~/.ssh/*,**/secrets/*`.
- **Memoria md+grep**: topic upsert + stale + sync local (Engram SQLite → md+grep sin deps).
- **Ops**: `/doctor` + backups completos keep 5 + `--upgrade` (preserva memoria/config; aborta si el backup falla) + `--part/--status/--restore/--uninstall` modulares.
- **Rename**: display `Advisor`, npm `advisor-harness` (shim `consigliere-harness@final` + deprecate), estado vivo solo en `.advisor/`, cache v2 (ver § Compatibilidad rename).