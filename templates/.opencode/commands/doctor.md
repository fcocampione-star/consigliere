---
description: Diagnóstico del harness y memoria (health check inspirado en gentle-ai doctor).
agent: explore
subtask: true
---

Ejecuta diagnóstico del harness Advisor 2.0. Revisa (read-only, sin editar):

1. `opencode.json` — schema, default_agent `advisor`, subagent_depth 2, agents placeholders, bash harden deny/ask.
2. Memoria: `PROJECT_STATE.md` <100 líneas, §2 <80, `SUMMARY.md` <150, entradas con `topic:`, `review_after`, índice §4 coherente con `CHANGELOG/`.
3. Hooks: `.git/hooks/post-commit` existe y es ejecutable, apunta a `post-commit-memory-rotate.sh`.
4. Skills: `node .opencode/skills/_skill-loader/loader.mjs list` (usa cache) + `.agents/skills` vs `AGENTS.md` stack declarado, reporta faltantes.
5. Memoria lock: `.memory-lock` huérfano (si existe sin escritura anidada >5min).
6. Scripts: `.opencode/scripts/memory-index.mjs`, `memory-sync.mjs`, `doctor.mjs` existen y `node --check` ok.
7. Directorio: `CHANGELOG/`, `.advisor/backups/` (o legacy `.consigliere/backups/`), `.advisor/chunks/` (o legacy) existen, `.advisor/skill-registry.cache.json` v2 válido si existe (fallback lectura legacy).
8. Git: `git status` limpio, `git log --oneline -5`.

También ejecuta `node .opencode/scripts/doctor.mjs` si existe para chequeo programático.

Devuelve tabla: Check | Estado (✅/⚠️/❌) | Detalle | Fix sugerido (no aplicar). No edites nada.
