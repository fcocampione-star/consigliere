---
description: Diagnóstico del harness y memoria (health check inspirado en gentle-ai doctor).
agent: explore
subtask: true
---

Ejecuta diagnóstico del harness Advisor 2.0. Revisa (read-only, sin editar) por capas:

**A) Proyecto** (puede dar ✅/⚠️/❌):
1. `opencode.json` — schema, default_agent `advisor`, subagent_depth 2, bash harden deny/ask.
2. Memoria: `PROJECT_STATE.md` <100 líneas, §2 <80, `SUMMARY.md` <150, entradas con `topic:`, `review_after`, índice §4 coherente con `CHANGELOG/` (índice §4 y `review_after` = manual, no en `doctor.mjs`).
3. Lock: `.memory-lock` huérfano (>5min).
4. Directorio: `CHANGELOG/`, `.advisor/backups/`, `.advisor/chunks/` existen.

**B) Infra regenerable** (nunca error — fix único `npx advisor-harness@latest . --upgrade`):
- Hook `post-commit`, cache de skills, manifest, index, scripts ausentes → `ℹ️ regenerable`.

**C) Adopción stack** (informativo, sin sugerir fix):
- `<!--ADOPTION-STACK-->` presente en `AGENTS.md` → `ℹ️ "Stack sin editar — /routine para rellenar"`.
- Ausente → `✅` (stack ya editado).

También ejecuta `node .opencode/scripts/doctor.mjs` si existe para el chequeo programático (capas A/B/C; el exit code solo depende de la capa A).

Devuelve tabla: Check | Estado (✅/⚠️/ℹ️/❌) | Detalle | Fix sugerido (no aplicar). No edites nada.