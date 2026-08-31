# CONSIGLIERE 2.0 — Harness de agentes + memoria persistente para opencode

> **Solo por proyecto, sin instalación global.** Reusable scaffold que arranca cada proyecto con **agentes/subagentes** orquestados y **memoria persistente de 3 capas** (progresiva + buscable) + routing orgánico + SDD-lite integrado.

## ¿Qué genera?

```
<proyecto>/
├── .opencode/
│   ├── opencode.json              # default_agent, modelos cheap vs strong, bash harden
│   ├── agents/
│   │   ├── orchestrator.md        # primario, routing 1-3 vs 4+ files + SDD-lite
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
│   │   └── _skill-loader/         # loader.mjs + cache.mjs (fingerprint)
│   ├── scripts/
│   │   ├── memory-index.mjs       # search/timeline/get (md+grep)
│   │   ├── memory-sync.mjs        # export/import chunks locales
│   │   └── doctor.mjs             # health check
│   └── hooks/                     # post-commit-memory-rotate.sh + sync
├── .consigliere/
│   ├── backups/                   # harness-*.tgz keep 5 (upgrade)
│   ├── chunks/                    # memoria sync local (git-tracked opcional)
│   └── skill-registry.cache.json  # fingerprint cache
├── AGENTS.md                      # instrucciones raíz + stack + comandos dev
├── PROJECT_STATE.md               # CAPA 0 — siempre cargada + review_after
├── SUMMARY.md                     # CAPA 1 — última semana + topic (on-demand)
├── CHANGELOG/                     # CAPA 2 — historial semanal archivado
├── .gitignore
└── skills-lock.json
```

## Instalación — solo por proyecto

**No hay instalación global.** Usa uno de estos (todos 100% por proyecto):

```bash
# Recomendado — npx (siempre última versión, sin instalar)
npx consigliere@latest /ruta/proyecto --name mi-app --stack-backend node/express --autoskills 1 --git yes

# Desde clon del repo
git clone https://github.com/fcocampione-star/consigliere.git
node consigliere/init.mjs /ruta/proyecto
bash consigliere/init.sh --dir /ruta/proyecto
powershell -File consigliere/init.ps1 C:\ruta\proyecto   # Windows
init.cmd C:\ruta\proyecto                                  # CMD shim

# Actualizar harness existente (backup keep 5 en .consigliere/backups/)
npx consigliere@latest /ruta/proyecto --upgrade
node consigliere/init.mjs /ruta/proyecto --upgrade
```

> Si tenías instalación global previa (`~/.local/bin/consigliere-*` / `~/.local/share/consigliere`), bórrala: `rm -rf ~/.local/bin/consigliere* ~/.local/share/consigliere` (o `npm rm -g consigliere` si fue vía npm).

## Uso interactivo (guiado)

Todos estos son **guiados** — no necesitas pasar ruta por adelantado, te preguntan `📁 Ruta → Nombre → Stack → Modelos cheap vs strong → Autoskills → Git`:

```bash
# npx guiado (sin clonar, Windows/macOS/Linux idéntico — recomendado)
npx consigliere@latest
# o
npx consigliere-init

# con git clone (sin npx)
git clone https://github.com/fcocampione-star/consigliere.git
cd consigliere && git checkout consigliere-2.0
node init.mjs                # universal
./init.sh                    # macOS/Linux/Git Bash
powershell -File init.ps1    # Windows
init.cmd                     # CMD

# download ZIP (sin git clone)
# Descarga ZIP desde GitHub → descomprime → cd consigliere-main
node init.mjs          # o ./init.sh / powershell -File init.ps1
```

> Pasos tras descarga: 1) `cd consigliere` (o carpeta descomprimida) → 2) ejecuta uno de los comandos guiados arriba → 3) responde `📁 Ruta` con la ruta de tu proyecto (ej `C:\ruta\mi-app` o `/tmp/mi-app`) → 4) sigue Stack/Modelos/Git → 5) `cd /ruta/mi-app` → `AGENTS.md` → `/discover` → `/routine` → `/doctor`.

## Uso no-interactivo (CI / scripts)

```bash
npx consigliere@latest --dir /ruta/proyecto --name mi-app \
  --stack-db postgresql --stack-backend node/express --stack-frontend react/vite \
  --stack-auth jwt --stack-validation zod --stack-deploy docker \
  --autoskills 1 --git yes

# actualizar
npx consigliere@latest --dir /ruta/proyecto --upgrade
```

## Flujo de trabajo en cada proyecto

1. **cd** al proyecto generado.
2. Completa `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md`.
3. Opcional: asigna modelos por agente en `.opencode/opencode.json` (`cheap`=verifier/summarizer/explore, `strong`=builder/planner/critic).
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
- **Sync local**: `node .opencode/scripts/memory-sync.mjs export` → `.consigliere/chunks/<monday>.json` (git-tracked), `import` restaura en clone.
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

Cache fingerprint: `.consigliere/skill-registry.cache.json` (mtime+size), refresh con `loader.mjs refresh --force`.

## Estructura de este repositorio

```
consigliere/
├── init.sh                 # instalador bash solo proyecto
├── init.ps1                # instalador PowerShell solo proyecto
├── init.cmd                # shim CMD → init.ps1
├── init.mjs                # instalador Node universal (npx)
├── package.json            # publica en npm como `consigliere` v2.0.0
└── templates/              # plantillas {{VAR}} + scripts + cache
```

## Dependencias

| Instalador | Requeridas | Opcionales |
|---|---|---|
| `npx` / `init.mjs` | `node 18+`, `git` | `tar` (backups) |
| `init.sh` | `bash 4+`, `coreutils`, `git` | `node` (autoskills) |
| `init.ps1` | `PowerShell 5.1+`, `git` | `node` (autoskills) |

## Notas de diseño v2.0

- **Solo por proyecto** (inspirado `gentle-ai --scope workspace`): cero `~/.local/bin`, cero `PATH`, cero drift.
- **Routing orgánico**: 1-3 files direct vs 4+ delegated (Gentle AI `trigger-rules.md`).
- **SDD-lite integrado en `routine`** (≤650w Given/When/Then), no 10 fases pesadas.
- **Harden bash**: deny extendido `**/*.pem,**/*.key,**/.env*,~/.ssh/*,**/secrets/*` (Gentle AI permissions).
- **Memoria md+grep**: topic upsert + stale + sync local (Engram SQLite → md+grep sin deps).
- **Ops**: `/doctor` + backups keep 5 + ` --upgrade`.
