# {{PROJECT_NAME}} — Project Context

## Session workflow

- **Before any work**: read `PROJECT_STATE.md` for current phase, decisions, and pending items. Do NOT preload `SUMMARY.md` or `CHANGELOG/` by default — load them on-demand only when the task needs historical context.
- **After meaningful changes**: update `SUMMARY.md` with a concise entry (date, what was done, key decisions, verification). Omit file lists — the source of detail is `git log`. Do this when the user explicitly asks to save progress or when it's tactically implied (end of a session, completing a phase, significant structural change). Optionally delegate to the `@summarizer` subagent.

### Persistent context (3 layers)

| Layer | File | Loaded | Contents |
|-------|------|--------|----------|
| 0 — State | `PROJECT_STATE.md` | always | current phase, consolidated design decisions, code patterns, pending items (< ~100 lines) |
| 1 — Recent | `SUMMARY.md` | on-demand | last week's entries + archive index, no file lists (< ~150 lines) |
| 2 — Archive | `CHANGELOG/YYYY-MM-DD.md` | rare/on-demand | full weekly history (named by Monday date) |

- **Weekly rotation**: the oldest week's `SUMMARY.md` entries are moved to `CHANGELOG/` when the week changes (Monday) or when `SUMMARY.md` exceeds ~150 lines. Rotation is canonical in `/record` via the Node engine `.opencode/scripts/memory-rotate.mjs`; the post-commit git hook is an optional gated backup (`ADVISOR_ROTATE_HOOK=1`, off by default).
- **Rule**: historical detail lives in `CHANGELOG/` + `git log`. Never duplicate archived entries back into `SUMMARY.md`.
- **Anti-concurrency**: a `.memory-lock` directory guards concurrent memory writes; never leave it orphaned.

## Agent pipeline (Consigliere 2.0 (Advisor Harness) — routing orgánico + SDD-lite)

- Custom agents live in `.opencode/agents/`; commands in `.opencode/commands/`.
- `advisor` is the **primary** agent (Tab) que coordina: siempre lee `PROJECT_STATE.md` primero, luego aplica **routing orgánico** por **clase de riesgo**: esquema/auth/contrato/migración/irreversible/arquitectura → `delegated`/`spec-lite`; riesgo bajo → `direct`; el **conteo de files es solo desempate** (`spec-lite` ante ambigüedad duradera → spec ≤650w Given/When/Then).
- **One level of depth** (advisor delega); leaf agents `task: deny` (except `planner→explore` depth 2).
- **Models**: per-agent `model:` en `opencode.json` (placeholders `{{MODEL_*}}` → cheap=verifier/summarizer/explore, strong=builder/planner/critic). El harness solo valida la forma del id, nunca si tiene entitlement: si sale `OpenCode's free tier can only be used from within OpenCode`, ver la sección del README "Modelos del free tier" (es opencode, no el harness).
- **Builder safety**: bash harden `*: allow`, `deny` irreparable + `ask` sensibles (`**/.env*`, `**/*.pem`, `**/*.key`, `**/secrets/*`, `~/.ssh/*`, `git commit/amend/push`).
- **Commits proposed, never automatic** (`git commit/push/amend → ask`) y **solo tras cerrar memoria**: si hubo cambios, primero `/record` (paso `summarizer`) — el summarizer es el cierre; nunca propongas commit con la memoria sin registrar.
- Quick commands: `/discover [foco]`, `/routine <tarea> [--parallel --skip-verify --skip-critic]` (routing+spec-lite integrado), `/doctor`, `/record <contexto>` (6 campos + topic), `/review`, `/rotate-memory`, `/compact-state`, `/modo <educador|practicante|copiloto|auto>`.
- **Comunicación adaptativa**: Advisor detecta nivel por señales (educador→copiloto), nunca pregunta nivel; reglas anti-molestia en `advisor.md §8`.

## Stack

| Layer | Choice |
|-------|--------|
| DB | `{{STACK_DB}}` |
| Backend | `{{STACK_BACKEND}}` ({{LANG_BACKEND}}) |
| Frontend | `{{STACK_FRONTEND}}` |
| Auth | `{{STACK_AUTH}}` |
| Validación | `{{STACK_VALIDATION}}` |
| Deploy | `{{STACK_DEPLOY}}` |

<!--ADOPTION-STACK-->

## Dev commands

```bash
# Añade aquí tus comandos
{{DEV_COMMANDS}}
```

## Directory structure

> El harness vive en la **raíz** del repositorio, junto a tu app, y se commitea con ella. No hay que sacarlo del repo: se excluye del **artefacto de producción** (build/deploy), no del repositorio. Si tu app usa `AGENTS.md`, `opencode.json` o `.gitignore` en la raíz, `--upgrade` los regenera: pon la app en una **subcarpeta** para evitar la colisión.

```
{{PROJECT_NAME}}/
├── AGENTS.md             # este archivo (harness)
├── opencode.json         # agentes + modelos + bash harden (harness)
├── .opencode/            # agents, commands, skills, scripts del harness
├── .agents/skills/       # autoskills autoinstaladas (harness)
├── .advisor/             # estado vivo local: backups/, chunks/, caches (gitignored: backups/ y cache)
├── PROJECT_STATE.md      # capa 0 — estado, decisiones, pendientes
├── SUMMARY.md            # capa 1 — progreso reciente
├── CHANGELOG/            # capa 2 — histórico semanal
├── .gitignore
└── <tu-app>/             # tu código (src/, tests/, docs/…) — subcarpeta recomendada
```

## Harness (tooling del proyecto)

El harness de agentes + memoria (`.opencode/`, `.agents/skills/`, `.advisor/` y el pipeline de arriba) es **tooling del proyecto**: se instala en la raíz del repo y se commitea con él. No edites sus internos a mano: se regeneran con `--upgrade`.

**Un repo, un harness + memoria compartidos.** El equipo comparte harness y memoria versionándolos en el mismo repositorio del proyecto (un clon, un `PROJECT_STATE.md`, un `SUMMARY.md`, un `CHANGELOG/`). No hace falta un repo aparte para el harness. `.advisor/` es estado local (backups, caches) y está gitignored.

**Harness vs artefacto de producción.** El harness se queda **commiteado en tu repo**; lo que se excluye es el **artefacto de release**: no lo copies al build, ignóralo en tu `.dockerignore` y, si usas `git archive`, añade tú un `.gitattributes` con `export-ignore` (el harness **no** lo genera). `--uninstall --part harness` **no es un filtro de build**: borra archivos en el sitio y deja `.advisor/`, `.agents/` y la memoria; úsalo solo sobre una **copia desechable**, nunca sobre tu repo de trabajo.

| Operación | Cómo |
|-----------|------|
| Diagnóstico | `/doctor` |
| Registrar progreso | `/record <contexto>` |
| Rotar memoria semanal | `/rotate-memory` |
| Compactar PROJECT_STATE | `/compact-state` |
| Límites memoria | `PROJECT_STATE.md` <100 líneas · `SUMMARY.md` <150 |
| Actualizar harness | `npx advisor-harness@latest . --upgrade` (backup previo obligatorio: preserva `PROJECT_STATE.md`, `SUMMARY.md` y `CHANGELOG/`; regenera `AGENTS.md`, `opencode.json` y `.gitignore`) |

> Instalador y actualizaciones: **Node.js >= 20.11** en todas las vías. Desde el clon del repo hay cuatro puntos de entrada —`node init.mjs`, que es la única implementación, y los tres lanzadores `init.sh`, `init.ps1` e `init.cmd`, que la ejecutan a través de Node— y con el paquete publicado, `npx advisor-harness@latest`. `tar` es necesario para el backup previo y `--restore`.

## Key architecture decisions

*(Capture the project's durable design decisions here as they are consolidated — or see PROJECT_STATE.md §2.)*