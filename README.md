# CONSIGLIERE — Harness de agentes + memoria persistente para opencode

Reusable scaffold que arranca cada proyecto con un sistema de **agentes/subagentes** orquestados y una **memoria persistente de 3 capas**, para hacer el diseño de aplicaciones más eficiente y el uso de tokens más económico.

## ¿Qué genera?

Un directorio de proyecto nuevo con:

```
<proyecto>/
├── .opencode/
│   ├── opencode.json              # default_agent, modelos, bash allowlist
│   ├── agents/
│   │   ├── orchestrator.md        # primario, solo delega vía task
│   │   ├── planner.md             # diseña sin tocar código
│   │   ├── critic.md              # revisa decisiones de diseño
│   │   ├── builder.md             # implementa (con bash allowlist)
│   │   ├── verifier.md            # typecheck/lint/tests
│   │   └── summarizer.md          # memoria 3 capas + rotación + compactación
│   ├── commands/
│   │   ├── discover.md            # /discover → audita contexto + skills
│   │   ├── routine.md             # /routine → ciclo completo
│   │   ├── record.md              # /record → persistir progreso
│   │   ├── rotate-memory.md       # rotación semanal manual
│   │   └── compact-state.md       # compactar PROJECT_STATE.md
│   ├── plans/                     # AGENT-ORCHESTRATION.md, MEMORY-SYSTEM.md
│   ├── skills/
│   │   ├── _project-docs/         # plantilla de docs del stack
│   │   └── _skill-loader/         # carga chunks de skills bajo demanda
│   └── hooks/                     # post-commit-memory-rotate.sh
├── AGENTS.md                      # instrucciones raíz + stack + comandos dev
├── PROJECT_STATE.md               # CAPA 0 — siempre cargada
├── SUMMARY.md                     # CAPA 1 — última semana (on-demand)
├── CHANGELOG/                     # CAPA 2 — historial semanal archivado
├── .gitignore
└── skills-lock.json
```

## Instalación

### Tabla por sistema operativo

| OS | Método recomendado | Comando |
|---|---|---|
| **Cualquiera con Node 18+** (universal) | `npm` / `npx` | `npm i -g consigliere` → `consigliere-init /ruta/proyecto` <br> o sin instalar: `npx consigliere-init /ruta/proyecto` |
| **Linux / macOS** | `bash` | `./init.sh --install-global` → `consigliere-init /ruta/proyecto` |
| **Windows PowerShell 5.1+/7** | `PowerShell` nativo | `powershell -ExecutionPolicy Bypass -File .\init.ps1 -InstallGlobal` → `powershell -File ~\.local\bin\consigliere-init.ps1 C:\ruta\proyecto` <br> o CMD: `init.cmd C:\ruta\proyecto` |
| **Windows Git Bash / WSL** | `bash` | `./init.sh --install-global` (requiere Git for Windows) |

> `npm` es el instalador más universal: funciona en Linux, macOS y Windows sin `bash`. `brew` y `curl|bash` son vías secundarias solo Unix.

### Opción A — npm/npx (universal, recomendado si tienes Node)

```bash
# Instalación global (una vez)
npm i -g consigliere
consigliere-init --version          # debe mostrar CONSIGLIERE v1.0.0
consigliere-init /ruta/proyecto    # o consigliere /ruta/proyecto

# Sin instalación (siempre última versión)
npx consigliere-init /ruta/proyecto --name mi-app --stack-backend node/express --autoskills 1 --git yes
```

### Opción B — bash (Linux/macOS/Git Bash/WSL)

```bash
cd consigliere
./init.sh                          # modo interactivo
./init.sh --install-global         # instala en ~/.local/bin/consigliere-init
consigliere-init /ruta/proyecto
```

### Opción C — PowerShell (Windows nativo, sin bash ni Node)

```powershell
cd consigliere
powershell -ExecutionPolicy Bypass -File .\init.ps1          # modo interactivo
powershell -ExecutionPolicy Bypass -File .\init.ps1 -InstallGlobal
# Ahora desde cualquier carpeta:
powershell -File ~\.local\bin\consigliere-init.ps1 C:\ruta\proyecto
# Alternativa CMD:
init.cmd C:\ruta\proyecto
```

### Desinstalar

```bash
# según cómo instalaste:
npm rm -g consigliere                              # si fue vía npm
consigliere-init --uninstall-global                # vía Node (init.mjs)
./init.sh --uninstall-global                       # vía bash
powershell -File .\init.ps1 -UninstallGlobal       # vía PowerShell
```

## Uso interactivo

```
$ ./init.sh
  ¿Qué quieres hacer?
  1) Instalar globalmente
  2) Crear un nuevo proyecto (harness)
  3) Desinstalar la versión global
  4) Salir
```

Si eliges crear proyecto, el asistente te guía paso a paso: directorio, nombre, stack, modelos por agente, autoskills y git.

## Uso no-interactivo (CI / scripts)

```bash
./init.sh --dir /ruta/proyecto --name mi-app \
  --stack-db postgresql --stack-backend node/express --stack-frontend react/vite \
  --stack-auth jwt --stack-validation zod --stack-deploy docker \
  --autoskills 1 --git yes
```

## Flujo de trabajo en cada proyecto

1. **cd** al proyecto generado.
2. Completa `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md` (URLs/shortcuts).
3. Opcional: asigna modelos por agente en `.opencode/opencode.json`.
4. Instala dependencias y corre `npx autoskills`.
5. En opencode: `/discover` (audita contexto + skills faltantes) → `/routine "configurar base del proyecto"`.

### Comandos del harness
- `/discover [foco]` — audita contexto del proyecto (stack real vs declarado) y skills presentes/faltantes (`_project-docs` + `autoskills` via `loader.mjs`).
- `/routine <tarea>` — ciclo completo: explore → plan → critic → build → verify → record.
- `/record <contexto>` — persiste el progreso en la memoria.
- `/rotate-memory` — rotación semanal manual.
- `/compact-state` — compacta `PROJECT_STATE.md`.

## Sistema de memoria (3 capas)

| Capa | Archivo | Carga | Contenido |
|------|---------|-------|-----------|
| 0 | `PROJECT_STATE.md` | siempre | fase, decisiones, patrones, pendientes (<100 líneas) |
| 1 | `SUMMARY.md` | on-demand | última semana + índice (<150 líneas) |
| 2 | `CHANGELOG/YYYY-MM-DD.md` | rare | historial semanal (nombrado por lunes) |

- **Rotación semanal automática**: hook `post-commit` mueve entradas antiguas a `CHANGELOG/`.
- **Anti-concurrencia**: `.memory-lock` guarda escrituras simultáneas.
- **Compactación**: `§2` de decisiones se compacta a `CHANGELOG/DECISIONS-ARCHIVE.md` cuando crece.

## Skills para subagentes

Los agentes (planner/builder/verifier/critic) pueden consultar skills vía `_skill-loader`:
```bash
node .opencode/skills/_skill-loader/loader.mjs list
node .opencode/skills/_skill-loader/loader.mjs search "query"
node .opencode/skills/_skill-loader/loader.mjs chunk "<skill>" urls,shortcuts,examples
```
Esto carga solo los chunks necesarios y ahorra tokens.

## Estructura de este repositorio

```
consigliere/
├── init.sh                 # instalador bash (Linux/macOS/Git Bash/WSL)
├── init.ps1                # instalador PowerShell (Windows nativo)
├── init.cmd                # shim CMD → init.ps1
├── init.mjs                # instalador Node cross-platform (universal, npm)
├── package.json            # publica en npm como `consigliere`
└── templates/              # plantillas renderizables (placeholders {{VAR}})
```

## Dependencias

| Instalador | Requeridas | Opcionales |
|---|---|---|
| `init.mjs` / `npm` (universal) | `node 18+`, `git` | — |
| `init.sh` (Unix) | `bash 4+`, `coreutils`, `git` | `gettext` (envsubst), `node` (autoskills) |
| `init.ps1` (Windows) | `PowerShell 5.1+`, `git` | `node` (autoskills) |

## Notas de diseño

Este harness aplica "Robusto v1": corrige las fallas del diseño original de FaceIT:
- Bash allowlist en builder autosuficiente (`*: allow`, solo `deny` irreparable + `git push → ask`).
- Modelo por agente (placeholders configurables).
- Agente `critic` para revisar decisiones de diseño.
- Rotación de memoria automática vía hook post-commit.
- Locking anti-concurrencia en memoria.
- Compactación de decisiones.
- Carga de skills bajo demanda (chunks) para ahorrar tokens.
