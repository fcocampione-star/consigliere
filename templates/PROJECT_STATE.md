# PROJECT_STATE — {{PROJECT_NAME}} (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Este archivo es la ÚNICA fuente que los agentes deben leer obligatoriamente al iniciar una sesión. `SUMMARY.md` (última semana) y `CHANGELOG/` (historial archivado) se leen **solo on-demand** cuando la tarea requiere contexto histórico. Estructura/detalle técnico completo: `AGENTS.md` y `.opencode/plans/`.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| (fase inicial) | Definir el objetivo, stack y estructura base del proyecto | ⏳ Pendiente |

> Próximo hito recomendado: configurar la base del proyecto (`AGENTS.md`, stack, estructura). Ver `.opencode/plans/` para planes de trabajo del agente.

---

## 2. Decisiones de diseño (append-only, consolidadas)

- (Registra aquí cada decisión de diseño arquitectónico en 1-2 frases, fusionando duplicados. Mantener §2 < ~80 líneas; compactar via `/compact-state` cuando exceda.)

---

## 3. Pendientes inmediatos

- [ ] Definir objetivo y alcance inicial del proyecto.
- [ ] Completar `AGENTS.md` (stack, comandos dev) y `.opencode/skills/_project-docs/SKILL.md`.
- [ ] Configurar la estructura base del proyecto.

---

## 4. Índice de historial archivado (CAPA 2)

> `CHANGELOG/YYYY-MM-DD.md` — historial semanal archivado (nombrado por lunes).

| Semana (lunes) | Archivo | Resumen |
|----------------|---------|---------|
| (aún sin historial) | — | — |

> Decisiones superadas: `CHANGELOG/DECISIONS-ARCHIVE.md`.

---

## 5. Patrones de código (Code Patterns)

> Memoria de "cómo se hace X aquí" — reutilizable por planner/builder/critic.

| Patrón | Archivo/Ejemplo | Descripción |
|--------|-----------------|-------------|
| (aún sin patrones) | — | — |

---

## 6. Índices de búsqueda

- **Decisiones**: `PROJECT_STATE.md §2` + `CHANGELOG/DECISIONS-ARCHIVE.md`.
- **Patrones**: `§5` arriba.
- **Features completadas**: `SUMMARY.md` + `CHANGELOG/*.md`.
- **Comandos dev**: `AGENTS.md` sección Development commands.
