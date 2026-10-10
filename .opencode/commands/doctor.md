---
description: Diagnóstico del harness y memoria (health check inspirado en gentle-ai doctor).
agent: explore
subtask: true
---

Ejecuta diagnóstico del harness Advisor 2.0. Revisa (read-only, sin editar):

1. `opencode.json` — que exista y parsee como JSON, `default_agent: advisor`, `subagent_depth: 2` y harden bash (`agent.builder.permission.bash["cat **/.env*"] → ask`).
2. Memoria: `PROJECT_STATE.md` <100 líneas, §2 <80, `SUMMARY.md` <150, entradas con `topic:`, índice §4 coherente con `CHANGELOG/` (índice §4 = manual). El `review_after` vencido / `stale[]` del manifest lo reporta `doctor.mjs` como ℹ️ informativo (no bloqueante); `/review` detalla y `/review --mark <topic>` extiende +90d.
3. Hook post-commit: **opcional/backup gated** (`ADVISOR_ROTATE_HOOK=1`); informa si existe y es ejecutable. Su ausencia o desactivación por defecto **NO** es warning (la rotación canónica la dispara `/record` vía `memory-rotate.mjs`). Si existe `.advisor/rotation.log`, menciónalo.
4. Skills: `node .opencode/skills/_skill-loader/loader.mjs list` (usa cache) + `.agents/skills` vs `AGENTS.md` stack declarado, reporta faltantes (comparativa vs stack = manual, no en `doctor.mjs`).
5. Memoria lock: `.memory-lock` huérfano. Usa `node .opencode/scripts/memory-lock.mjs status` (umbral `LOCK_STALE_MS` del helper, default 5min); no borres el directorio a mano (libéralo con `release --force`).
6. Scripts: presencia de `.opencode/scripts/{memory-index,memory-sync,memory-lock,memory-stats,memory-rotate,memory-tokens,skill-search,skill-scaffold,doctor}.mjs` (`node --check` de cada uno = manual, no en `doctor.mjs`). El check `tokens` (ℹ️) confirma que el estimador `memory-tokens.mjs` existe y apunta al comando `compare --scenario`.
7. Directorio: `CHANGELOG/`, `.advisor/backups/`, `.advisor/chunks/` existen, `.advisor/skill-registry.cache.json` v2 válido si existe.
8. Git: `git status` limpio, `git log --oneline -5` (manual, no en `doctor.mjs`).

También ejecuta `node .opencode/scripts/doctor.mjs` si existe para el chequeo programático: cubre `opencode.json` + harden, tamaños y `topic:` de la memoria, hook/`rotation.log`, lock, cache de skills, scripts, directorios de estado y los derivados (`memory-manifest.json`, índice, `review_after`). Los derivados ausentes o corruptos son ℹ️ (regenerables) y nunca degradan el exit; el exit code es 0 (ok), 1 (warnings) o 2 (errores). No cites un número de checks: cambia con cada condicional.

Devuelve tabla: Check | Estado (✅/⚠️/❌) | Detalle | Fix sugerido (no aplicar). No edites nada.
