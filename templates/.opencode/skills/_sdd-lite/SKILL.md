---
name: _sdd-lite
description: |
  Specs ligeras Given/When/Then (≤650 palabras) para el harness Advisor.
  Use when you need: escribir o revisar una spec-lite antes de implementar (routing spec-lite, criterios RFC2119, formato /routine).
chunks: [urls, patterns, shortcuts, examples, commands]
metadata:
  version: 1.0.0
---

# _sdd-lite — Spec Lite (≤650 palabras)

> Specs mínimas accionables para el routing `spec-lite` del harness Advisor: ambigüedad duradera → spec corta → critic → build.

## 1. Official URLs Table

<!-- CHUNK: urls -->
| Technology | Official Docs | Notes |
|------------|---------------|-------|
| Gherkin / Given-When-Then | https://cucumber.io/docs/gherkin/ | Sintaxis de criterios |
| RFC2119 keywords | https://www.rfc-editor.org/rfc/rfc2119 | MUST/SHOULD/MAY |
| Advisor routine | `.opencode/commands/routine.md` | Routing orgánico + spec-lite integrado |

<!-- /CHUNK -->
<!-- CHUNK: patterns -->
### Cuándo usar spec-lite

- El orchestrator la exige si hay **ambigüedad duradera** (≥2 interpretaciones razonables tras explore).
- Scope típico: 1 spec por tarea `delegated`; si supera ~650 palabras, dividir en 2 specs.

### Estructura obligatoria

```markdown
# spec: <family/kebab> (≤650w)

## MUST (RFC2119)
- MUST-1: <qué> — Given <ctx> When <acción> Then <resultado>
- MUST-2: ...

## SHOULD
- SHOULD-1: ...

## Veredicto critic
- APROBADO / APROBADO CON AJUSTES / RECHAZADO + ajustes obligatorios numerados
```

### Reglas

- Cada MUST lleva su `Given/When/Then`; sin GWT no es verificable.
- Prohíbe listas exhaustivas de archivos si son >15 (agrupa por familia).
- Formato de retorno del build: rama+base, archivos (agrupados), comandos+resultado, decisiones, riesgos, listo-para-verifier sí/no.

<!-- /CHUNK -->
<!-- CHUNK: shortcuts -->
| Shortcut | Expands To | Use Case |
|----------|------------|----------|
| `/routine <tarea>` | explore→plan/spec→critic→build→verify→record | Flujo con spec-lite integrada |
| `spec-lite` | spec ≤650w Given/When/Then | Decidir antes de codificar |
| `critic` | veredicto + ajustes obligatorios | Puerta antes del build |

<!-- /CHUNK -->
<!-- CHUNK: examples -->
### Ejemplo mínimo

```markdown
# spec: sdd/demo-hola/spec

## MUST
- MUST-1 saludo: Given repo inicializado When ejecuto `node hola.mjs` Then imprime `hola` y exit 0.
- MUST-2 sin dependencias: Given `node --version` ≥18 When instalo Then no requiere `npm install`.

## SHOULD
- SHOULD-1 documentar uso en README (3 líneas).

## Veredicto critic
- APROBADO CON AJUSTES: 1. probar en Windows + Linux.
```

<!-- /CHUNK -->
<!-- CHUNK: commands -->
```bash
# Ver plantillas y flujo que consumen spec-lite
node .opencode/scripts/doctor.mjs --json              # puertas del harness
node .opencode/skills/_skill-loader/loader.mjs chunk "_sdd-lite" patterns,examples
```

<!-- /CHUNK -->
