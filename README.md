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

### Usar desde la carpeta (modo local)
```bash
cd consigliere
./init.sh
```

### Instalar globalmente (una vez)
```bash
cd consigliere
./init.sh --install-global
# Ahora desde cualquier carpeta:
consigliere-init /ruta/proyecto
```

### Desinstalar
```bash
consigliere-init --uninstall-global
# o
./init.sh --uninstall-global
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
5. En opencode: `/routine "configurar base del proyecto"`.

### Comandos del harness
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
├── init.sh                 # instalador + generador interactivo
└── templates/              # plantillas renderizables (placeholders {{VAR}})
```

## Dependencias

- **Requeridas**: `bash 4+`, `coreutils`, `git`.
- **Opcionales**: `gettext` (envsubst, render más limpio), `node` (autoskills y skill-loader).

## Notas de diseño

Este harness aplica "Robusto v1": corrige las fallas del diseño original de FaceIT:
- Bash allowlist en builder (bloquea `rm -rf`, `git push`, `sudo`).
- Modelo por agente (placeholders configurables).
- Agente `critic` para revisar decisiones de diseño.
- Rotación de memoria automática vía hook post-commit.
- Locking anti-concurrencia en memoria.
- Compactación de decisiones.
- Carga de skills bajo demanda (chunks) para ahorrar tokens.
