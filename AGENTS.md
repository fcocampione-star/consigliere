# consigliere — Project Context

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

## Agent pipeline (Consigliere 2.0 — routing orgánico + SDD-lite)

- Custom agents live in `.opencode/agents/`; commands in `.opencode/commands/`.
- `orchestrator` is the additional **primary** agent (Tab) que coordina: siempre lee `PROJECT_STATE.md` primero, luego aplica **routing orgánico**: `direct` (1-3 files) vs `delegated` (4+ files / 2+ writes) vs `spec-lite` (ambigüedad duradera → spec ≤650w Given/When/Then).
- **One level of depth** (orchestrator delega); leaf agents `task: deny` (except `planner→explore` depth 2).
- **Models**: per-agent `model:` en `opencode.json` (placeholders `{{MODEL_*}}` → cheap=verifier/summarizer/explore, strong=builder/planner/critic).
- **Builder safety**: bash harden `*: allow`, `deny` irreparable + `ask` sensibles (`**/.env*`, `**/*.pem`, `**/*.key`, `**/secrets/*`, `~/.ssh/*`, `git push`).
- **Commits proposed, never automatic** (`git commit/push/amend → ask`).
- Quick commands: `/discover [foco]`, `/routine <tarea> [--parallel --skip-verify --skip-critic]` (routing+spec-lite integrado), `/doctor`, `/record <contexto>` (5 campos + topic), `/review`, `/rotate-memory`, `/compact-state`.

## Stack

| Layer | Choice |
|-------|--------|
| DB | N/A — Markdown + grep (PROJECT_STATE.md / SUMMARY.md / CHANGELOG/YYYY-MM-DD.md + memory-index.mjs grep+perl, cache .consigliere/skill-registry.cache.json; sqlite3 solo fallback) |
| Backend | Node.js >=18 ESM (init.mjs) + Bash 4+ / PowerShell 5.1+ + git/tar — harness CLI (scripts .opencode/scripts/*.mjs, loader.mjs) |
| Frontend | N/A — harness CLI sin UI (genera .opencode/ para opencode TUI; instalador para proyecto vacío) |
| Auth | N/A — local sin auth; bash harden opencode.json (*:allow, deny rm/dd/mkfs, ask **/.env*/**/*.pem/**/.key/**/secrets/*/~/.ssh/* + git push) |
| Validation | node --check syntax (npm test = check init.mjs + loader + doctor + memory-index + memory-sync) |
| Deploy | npm registry consigliere@latest v2.0.0 via npx / init.mjs + init.sh + init.ps1 per-project, --upgrade con backup keep 5 en .consigliere/backups/ |

*(Edit this table with the actual stack of consigliere.)*

## Skills (con cache fingerprint)

- **Project docs**: `.opencode/skills/_project-docs/SKILL.md` — URLs, shortcuts, patterns, examples. Edita con tu stack real.
- **Autoskills**: `.agents/skills/*/SKILL.md` — auto `npx autoskills`.
- **Skill loader** (cache `.consigliere/skill-registry.cache.json`):
  - `node .opencode/skills/_skill-loader/loader.mjs list [--refresh|--json]`
  - `node .opencode/skills/_skill-loader/loader.mjs refresh`
  - `node .opencode/skills/_skill-loader/loader.mjs search "query"`
  - `node .opencode/skills/_skill-loader/loader.mjs chunk "<skill>" urls,shortcuts,examples`
- **Memoria buscable** (md+grep, sin SQLite): `node .opencode/scripts/memory-index.mjs search "query"` → `timeline <id>` → `get <id>`
- **Sync local**: `node .opencode/scripts/memory-sync.mjs export|import|status` → `.consigliere/chunks/`
- **Doctor**: `node .opencode/scripts/doctor.mjs [--json]` o `/doctor`

## Development commands

```bash
npm test                                              # node --check init.mjs + loader + doctor + memory scripts
node init.mjs /tmp/demo --name demo                   # probar instalador universal
node .opencode/scripts/doctor.mjs --json              # diagnóstico harness
node .opencode/skills/_skill-loader/loader.mjs list --json  # listar skills
node .opencode/scripts/memory-index.mjs search "query"      # búsqueda memoria md+grep
```

*(Fill in the actual dev commands for consigliere.)*

## Directory structure (2.0 solo por proyecto)

```
consigliere/
├── .opencode/               # agents/, commands/, plans/, skills/, scripts/, hooks/
├── .agents/skills/          # autoskills (npx autoskills)
├── .consigliere/            # backups/ (keep 5) + chunks/ (sync) + skill-registry.cache.json
├── PROJECT_STATE.md         # capa 0 — siempre + review_after
├── SUMMARY.md               # capa 1 — última semana + topic
├── CHANGELOG/               # capa 2 — semanal + DECISIONS-ARCHIVE.md
├── AGENTS.md                # este archivo
├── .gitignore
└── ... (source code)
```

## Key architecture decisions

*(Capture the project's durable design decisions here as they are consolidated — or see PROJECT_STATE.md §2.)*
