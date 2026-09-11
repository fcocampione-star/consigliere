---
description: Fija el modo de comunicación del advisor (educador|practicante|copiloto|auto) para adaptar tono y detalle a tu nivel. Sin argumento muestra el modo actual.
agent: advisor
subtask: true
---

Fija el modo de comunicación del advisor según el argumento:

- `/modo educador` — explica con analogías, pasos guiados y contexto amplio.
- `/modo practicante` — nivel profesional, criterios y alternativas breves.
- `/modo copiloto` — mínima fricción, ejecuta directamente ("solo hazlo").
- `/modo auto` — detección implícita por señales del usuario (default).
- `/modo` — muestra el modo actualmente activo.

Reglas:

1. Persiste **solo en sesión** (contexto conversacional): no escribas memoria ni `opencode.json`.
2. Propaga el modo a subagentes: inclúyelo en cada prompt delegado (contexto autocontenido) para que mantengan el mismo registro.
3. Un `/modo` explícito gana sobre la detección por señales hasta que se cambie o se vuelva a `auto`.