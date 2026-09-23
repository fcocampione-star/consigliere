---
description: Diagnóstico del harness y memoria (health check inspirado en gentle-ai doctor).
agent: explore
subtask: true
---

Ejecuta diagnóstico del harness Advisor 2.0. Revisa (read-only, sin editar):

1. `opencode.json` — schema, default_agent `advisor`, subagent_depth 2, agents placeholders, bash harden deny/ask.
2. Memoria: `PROJECT_STATE.md` <100 líneas, §2 <80, `SUMMARY.md` <150, entradas con `topic:`, índice §4 coherente con `CHANGELOG/` (índice §4 = manual). El `review_after` vencido / `stale[]` del manifest lo reporta `doctor.mjs` como ℹ️ informativo (no bloqueante); `/review` detalla y `/review --mark <topic>` extiende +90d.
3. Hook post-commit: **opcional/backup gated** (`ADVISOR_ROTATE_HOOK=1`); informa si existe y es ejecutable. Su ausencia o desactivación por defecto **NO** es warning (la rotación canónica la dispara `/record` vía `memory-rotate.mjs`). Si existe `.advisor/rotation.log`, menciónalo.
4. Skills: `node .opencode/skills/_skill-loader/loader.mjs list` (usa cache) + `.agents/skills` vs `AGENTS.md` stack declarado, reporta faltantes (comparativa vs stack = manual, no en `doctor.mjs`).
5. Memoria lock: `.memory-lock` huérfano. Usa `node .opencode/scripts/memory-lock.mjs status` (umbral `LOCK_STALE_MS` del helper, default 5min); no borres el directorio a mano (libéralo con `release --force`).
6. Scripts: `.opencode/scripts/memory-index.mjs`, `memory-sync.mjs`, `doctor.mjs` existen (`node --check` de cada uno = manual, no en `doctor.mjs`).
7. Directorio: `CHANGELOG/`, `.advisor/backups/` (o legacy `.consigliere/backups/`), `.advisor/chunks/` (o legacy) existen, `.advisor/skill-registry.cache.json` v2 válido si existe (fallback lectura legacy).
8. Git: `git status` limpio, `git log --oneline -5` (manual, no en `doctor.mjs`).

También ejecuta `node .opencode/scripts/doctor.mjs` si existe para chequeo programático (16-17 checks, variable por condicionales §2/topic/manifest/index).

Devuelve tabla: Check | Estado (✅/⚠️/❌) | Detalle | Fix sugerido (no aplicar). No edites nada.
