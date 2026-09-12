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

- **Weekly rotation**: the oldest week's `SUMMARY.md` entries are moved to `CHANGELOG/` when the week changes (Monday) or when `SUMMARY.md` exceeds ~150 lines. The summarizer agent + the post-commit git hook enforce this.
- **Rule**: historical detail lives in `CHANGELOG/` + `git log`. Never duplicate archived entries back into `SUMMARY.md`.
- **Anti-concurrency**: a `.memory-lock` directory guards concurrent memory writes; never leave it orphaned.

## Agent pipeline (Advisor 2.0 — routing orgánico + SDD-lite)

- `advisor` is the **primary** agent (Tab) que coordina: siempre lee `PROJECT_STATE.md` primero, luego aplica **routing orgánico**: `direct` (1-3 files) vs `delegated` (4+ files / 2+ writes) vs `spec-lite` (ambigüedad duradera → spec ≤650w Given/When/Then).
- **One level of depth** (advisor delega); leaf agents `task: deny` (except `planner→explore` depth 2).
- **Builder safety**: bash harden `*: allow`, `deny` irreparable + `ask` sensibles (`**/.env*`, `**/*.pem`, `**/*.key`, `**/secrets/*`, `~/.ssh/*`, `git push`).
- **Commits proposed, never automatic** (`git commit/push/amend → ask`).
- Quick commands: `/discover [foco]`, `/routine <tarea> [--parallel --skip-verify --skip-critic]`, `/record <contexto>` (5 campos + topic), `/review`, `/modo <educador|practicante|copiloto|auto>`.
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

```
{{PROJECT_NAME}}/
├── src/                  # código del proyecto
├── tests/                # tests del proyecto
├── docs/                 # documentación
├── PROJECT_STATE.md      # capa 0 — estado, decisiones, pendientes
├── SUMMARY.md            # capa 1 — progreso reciente
├── CHANGELOG/            # capa 2 — histórico semanal
├── AGENTS.md             # este archivo
├── .gitignore
└── Harness (no tocar)/
    ├── .opencode/        # agents, commands, skills, scripts del harness
    ├── .agents/skills/   # autoskills autoinstaladas
    └── .advisor/         # estado vivo: backups/, chunks/, caches
```

## Harness (no tocar)

El harness de agentes + memoria (`.opencode/`, `.agents/skills/`, `.advisor/` y el pipeline de arriba) se instala y actualiza por comando. No edites sus internos a mano (se regeneran con `--upgrade`).

| Operación | Cómo |
|-----------|------|
| Diagnóstico | `/doctor` |
| Registrar progreso | `/record <contexto>` |
| Rotar memoria semanal | `/rotate-memory` |
| Compactar PROJECT_STATE | `/compact-state` |
| Límites memoria | `PROJECT_STATE.md` <100 líneas · `SUMMARY.md` <150 |
| Actualizar harness | `npx advisor-harness@latest . --upgrade` |

## Key architecture decisions

*(Capture the project's durable design decisions here as they are consolidated — or see PROJECT_STATE.md §2.)*