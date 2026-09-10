# ADVISOR 2.0 — Harness de agentes + memoria persistente para opencode

> **Solo por proyecto.** Reusable scaffold que arranca cada proyecto con **agentes/subagentes** orquestados y **memoria persistente de 3 capas** (progresiva + buscable) + routing orgánico + SDD-lite integrado.

> **⚠️ Disponibilidad de `npx`:** la instalación vía `npx advisor-harness@latest` requiere que el paquete esté publicado en npm (hito futuro, aún no publicado). **Hoy solo funcionan las instrucciones locales** (`git clone` + `node init.mjs` / `bash init.sh` / `powershell -File init.ps1`). Tras el publish, la vía `npx` quedará disponible sin cambios de uso.

> **Primeros pasos (30 segundos):**
> 1. `git clone https://github.com/fcocampione-star/consigliere.git && cd consigliere && node init.mjs` → responde el asistente (`📁 Ruta → Nombre → Stack → Modelos → Autoskills → Git`)
> 2. `cd /ruta/mi-app` → abre `opencode`
> 3. `/discover` (audita contexto + skills) → `/routine "configurar base del proyecto"` → `/doctor`

## ¿Qué genera?

```
<proyecto>/
├── .opencode/
│   ├── agents/
│   │   ├── advisor.md             # primario, routing 1-3 vs 4+ files + SDD-lite
│   │   ├── explore.md             # audita contexto + skills (leaf, depth 2)
│   │   ├── planner.md             # diseña + spec Given/When/Then (≤650w)
│   │   ├── critic.md              # revisa decisiones de diseño
│   │   ├── builder.md             # implementa (bash harden)
│   │   ├── verifier.md            # typecheck/lint/tests
│   │   └── summarizer.md          # memoria 3 capas + topic upsert + session summary
│   ├── commands/
│   │   ├── discover.md            # /discover → audita contexto + skills
│   │   ├── routine.md             # /routine → explore→plan/spec→critic→build→verify→record
│   │   ├── doctor.md              # /doctor → diagnóstico harness + memoria
│   │   ├── record.md              # /record → persistir progreso (5 campos)
│   │   ├── review.md              # /review → decisiones stale (review_after)
│   │   ├── rotate-memory.md       # rotación semanal manual
│   │   └── compact-state.md       # compactar PROJECT_STATE.md
│   ├── plans/                     # AGENT-ORCHESTRATION.md, MEMORY-SYSTEM.md
│   ├── skills/
│   │   ├── _project-docs/         # plantilla de docs del stack
│   │   ├── _sdd-lite/             # spec-lite ≤650w Given/When/Then
│   │   └── _skill-loader/         # loader.mjs + SKILL.md (cache fingerprint en .advisor/)
│   ├── scripts/
│   │   ├── memory-index.mjs       # search/timeline/get (md+grep)
│   │   ├── memory-sync.mjs        # export/import chunks locales
│   │   └── doctor.mjs             # health check
│   └── hooks/                     # post-commit-memory-rotate.sh + sync
├── .advisor/                    # estado VIVO (backups/chunks/cache)
│   ├── backups/                   # advisor-*.tgz completo keep 5 (upgrade; acepta harness-* legacy)
│   ├── chunks/                    # memoria sync local (git-tracked opcional)
│   └── skill-registry.cache.json  # fingerprint cache v2
├── .consigliere/                  # legacy pre-rename: fallback SOLO lectura (no escribir, sin symlink)
├── AGENTS.md                      # instrucciones raíz + stack + comandos dev
├── opencode.json                  # default_agent, modelos cheap vs strong, bash harden
├── PROJECT_STATE.md               # CAPA 0 — siempre cargada + review_after
├── SUMMARY.md                     # CAPA 1 — última semana + topic (on-demand)
├── CHANGELOG/                     # CAPA 2 — historial semanal archivado
├── scripts/                       # check-memory-limits.sh/.ps1 (límites 100/150)
├── .gitignore
└── skills-lock.json
```

## Instalación — solo por proyecto

Usa uno de estos (todos 100% por proyecto):

```bash
# Recomendado — desde clon del repo (la vía npx vendrá con el publish a npm)
git clone https://github.com/fcocampione-star/consigliere.git
node consigliere/init.mjs /ruta/proyecto --name mi-app --stack-backend node/express --autoskills 1 --git yes

# Mismo clon, otros instaladores
bash consigliere/init.sh --dir /ruta/proyecto --name mi-app --stack-backend node/express --autoskills 1 --git yes
powershell -File consigliere/init.ps1 C:\ruta\proyecto -Name mi-app -StackBackend node/express -Autoskills 1 -Git yes
init.cmd C:\ruta\proyecto

# Actualizar harness existente: --upgrade hace backup completo keep 5
# (incluye .opencode/, AGENTS.md, PROJECT_STATE.md, SUMMARY.md, CHANGELOG/, .advisor/,
#  .consigliere/ legacy, opencode.json, .gitignore, skills-lock.json, scripts/) y preserva memoria/config
# (PROJECT_STATE.md, SUMMARY.md, opencode.json, AGENTS.md, .gitignore). Si el backup falla, aborta.
node consigliere/init.mjs /ruta/proyecto --upgrade
bash consigliere/init.sh --dir /ruta/proyecto --upgrade
powershell -File consigliere/init.ps1 C:\ruta\proyecto -Upgrade
```

## Uso interactivo (guiado)

Todos estos son **guiados** — no necesitas pasar ruta por adelantado, te preguntan `📁 Ruta → Nombre → Stack → Modelos cheap vs strong → Autoskills → Git`:

```bash
# guiado — con git clone (recomendado; la vía npx llegará con el publish a npm)
git clone https://github.com/fcocampione-star/consigliere.git
cd consigliere
node init.mjs                # universal
./init.sh                    # macOS/Linux/Git Bash
powershell -File init.ps1    # Windows
init.cmd                     # CMD

# download ZIP (sin git clone)
# Descarga ZIP desde GitHub → descomprime → cd consigliere-main
node init.mjs          # o ./init.sh / powershell -File init.ps1
```

> Descarga ZIP / git clone: 1) `cd consigliere` (o carpeta descomprimida) → 2) ejecuta un comando guiado de la sección anterior → 3) responde `📁 Ruta` (ej `C:\ruta\mi-app` o `/tmp/mi-app`) → 4) sigue Stack/Modelos/Git → 5) continúa en el paso 2 de **Primeros pasos** (cd /ruta/mi-app → opencode → /discover → /routine → /doctor).

## Uso no-interactivo (CI / scripts)

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

## Compatibilidad rename (consigliere → Advisor)

- **Display**: `Advisor`; **npm**: `advisor-harness` (`npx advisor-harness@latest`); **bin**: `advisor`, `advisor-harness` + alias `consigliere-harness` (1 versión de transición).
- **Publicación**: `advisor-harness` nuevo + `consigliere-harness@final` como shim (warning + exec `advisor-harness`) con `npm deprecate` apuntando al nuevo nombre.
- **Repo**: `https://github.com/fcocampione-star/consigliere.git`.
- **Estado dual-dir (sin symlink, Windows-safe)**: leer `.advisor/` primero, fallback read-only a legacy `.consigliere/`; escribir **solo** `.advisor/`; migración por copia + `.advisor/.migrated`. Precedencia documentada: `.advisor/` gana siempre.
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
- `/routine <tarea> [--parallel --skip-verify --skip-critic]` — routing orgánico: direct 1-3 files vs delegated 4+, plan/spec≤650w → critic → build → verify (stash rollback, 3 intentos) → record. SDD-lite integrado por defecto.
- `/doctor` — diagnóstico: `opencode.json`, memoria `<100/<150`, hook, lock huérfano, skills.
- `/record <contexto>` — persiste con formato 5 campos `Goal/Discoveries/Accomplished/Next/Files` (compat `Qué/Verificación`).
- `/review` — lista decisiones stale (`review_after` +90d).
- `/rotate-memory` — rotación semanal manual.
- `/compact-state` — compacta `PROJECT_STATE.md` §2 (dedup + archive).

## Sistema de memoria (3 capas, inspirado Engram pero md+grep)

| Capa | Archivo | Carga | Contenido |
|------|---------|-------|-----------|
| 0 | `PROJECT_STATE.md` | siempre | fase, decisiones + `review_after`, patrones, pendientes (<100 líneas) |
| 1 | `SUMMARY.md` | on-demand | última semana + `topic: family/kebab` + índice (<150 líneas) |
| 2 | `CHANGELOG/YYYY-MM-DD.md` | rare | historial semanal (lunes) + `DECISIONS-ARCHIVE.md` |

- **Topic upsert**: `topic: architecture/auth-model` 2 niveles; mismo topic → upsert no duplicado.
- **Búsqueda progresiva (sin SQLite)**: `node .opencode/scripts/memory-index.mjs search "query"` → IDs, `timeline <id>`, `get <id>` (grep+perl, fallback si `sqlite3` ausente).
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
├── package.json            # publica en npm como `advisor-harness` v2.0.0
└── templates/              # plantillas {{VAR}} + scripts + cache
```

## Dependencias

| Instalador | Requeridas | Opcionales |
|---|---|---|
| `init.mjs` (node) | `node 18+`, `git`, `tar` (requerido para `--upgrade`) | — |
| `init.sh` | `bash 4+`, `coreutils`, `git`, `tar` (requerido para `--upgrade`) | `node` (autoskills) |
| `init.ps1` | `PowerShell 5.1+`, `git`, `tar` (requerido para `--upgrade`) | `node` (autoskills) |

## Notas de diseño v2.0

- **Solo por proyecto**: cero `~/.local/bin`, cero `PATH`, cero drift.
- **Routing orgánico**: 1-3 files direct vs 4+ delegated.
- **SDD-lite integrado en `routine`** (≤650w Given/When/Then), no 10 fases pesadas.
- **Harden bash**: deny extendido `**/*.pem,**/*.key,**/.env*,~/.ssh/*,**/secrets/*`.
- **Memoria md+grep**: topic upsert + stale + sync local (Engram SQLite → md+grep sin deps).
- **Ops**: `/doctor` + backups completos keep 5 + ` --upgrade` (preserva memoria/config; aborta si el backup falla) + `--part/--status/--restore/--uninstall` modulares.
- **Rename**: display `Advisor`, npm `advisor-harness` (shim `consigliere-harness@final` + deprecate), estado `.advisor/` + fallback legacy read-only, cache v2 (ver § Compatibilidad rename).
