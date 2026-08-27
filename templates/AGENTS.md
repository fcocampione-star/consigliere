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

## Agent pipeline

- Custom agents live in `.opencode/agents/`; commands in `.opencode/commands/`.
- `orchestrator` is the additional **primary** agent (cycle with Tab) that coordinates multi-step work: always reads `PROJECT_STATE.md` first, then delegates to `explore` (built-in), `planner`, `critic`, `builder`, `verifier`, `summarizer`.
- **One level of depth** (orchestrator delegating); leaf agents (`planner`/`builder`/`verifier`/`critic`/`summarizer`) have `task: deny`.
- **Models**: each subagent can have its own `model:` in `opencode.json` (placeholders set at scaffold; edit to fill).
- **Builder safety**: a bash allowlist in `opencode.json` blocks destructive commands (`rm -rf`, `git push`, `sudo`, etc.).
- **Commits are proposed, never automatic** (`git commit/push/amend → ask`).
- Quick commands: `/routine <tarea>` (full plan→critique→build→verify→record cycle), `/record <contexto>` (persist progress), `/rotate-memory`, `/compact-state`.

## Stack

| Layer | Choice |
|-------|--------|
| DB | {{STACK_DB}} |
| Backend | {{STACK_BACKEND}} |
| Frontend | {{STACK_FRONTEND}} |
| Auth | {{STACK_AUTH}} |
| Validation | {{STACK_VALIDATION}} |
| Deploy | {{STACK_DEPLOY}} |

*(Edit this table with the actual stack of {{PROJECT_NAME}}.)*

## Skills

- **Project docs**: `.opencode/skills/_project-docs/SKILL.md` — URLs, shortcuts, patterns, examples of the project stack. Edit it to fill in your real stack.
- **Autoskills**: `.agents/skills/*/SKILL.md` — auto-installed via `npx autoskills` based on dependencies.
- **Skill loader**: `.opencode/skills/_skill-loader/loader.mjs` loads only needed chunks to save tokens:
  - `node .opencode/skills/_skill-loader/loader.mjs list`
  - `node .opencode/skills/_skill-loader/loader.mjs search "query"`
  - `node .opencode/skills/_skill-loader/loader.mjs chunk "<skill>" urls,shortcuts,examples`

## Development commands

```bash
{{DEV_COMMANDS}}
```

*(Fill in the actual dev commands for {{PROJECT_NAME}}.)*

## Directory structure

```
{{PROJECT_NAME}}/
├── .opencode/               # opencode config: agents/, commands/, plans/, skills/
├── .agents/skills/          # auto-installed AI skills (autoskills)
├── PROJECT_STATE.md         # layer 0 — always loaded: phase, decisions, patterns, pending
├── SUMMARY.md               # layer 1 — last week's entries + index, on-demand
├── CHANGELOG/               # layer 2 — weekly archived history (by Monday)
├── AGENTS.md                # this file
├── .gitignore
└── ... (source code)
```

## Key architecture decisions

*(Capture the project's durable design decisions here as they are consolidated — or see PROJECT_STATE.md §2.)*
