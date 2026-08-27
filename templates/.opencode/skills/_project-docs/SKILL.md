---
name: _project-docs
description: |
  Documentación específica del proyecto {{PROJECT_NAME}}. Carga bajo demanda via _skill-loader.
  Use when you need: official URLs, fetch patterns, shortcuts, and best practices for the {{PROJECT_NAME}} stack.
chunks: [urls, patterns, shortcuts, examples, commands]
metadata:
  version: 1.0.0
---

# {{PROJECT_NAME}} — Project Documentation

> Plantilla de documentación del stack. **Edita este archivo** para completar URLs, shortcuts, patrones y ejemplos de tu stack real.

## 1. Official URLs Table

<!-- CHUNK: urls -->
| Technology | Official Docs | API Reference | GitHub | Notes |
|------------|---------------|---------------|--------|-------|
| {{STACK_DB}} | | | | |
| {{STACK_BACKEND}} | | | | |
| {{STACK_FRONTEND}} | | | | |
| {{STACK_AUTH}} | | | | |
| {{STACK_VALIDATION}} | | | | |
| {{STACK_DEPLOY}} | | | | |

*(Rellena cada fila con la URL oficial de docs, API ref y GitHub.)*

---

## 2. Fetch Patterns (Common Queries)

<!-- /CHUNK -->
<!-- CHUNK: patterns -->
Use `webfetch` con estas queries para documentación en vivo. *(Edita según tu stack.)*

### {{STACK_BACKEND}}
```bash
webfetch "<URL_OFFICIAL>/<ruta>" --format markdown
```

### {{STACK_FRONTEND}}
```bash
webfetch "<URL_OFFICIAL>/<ruta>" --format markdown
```

### {{STACK_DB}}
```bash
webfetch "<URL_OFFICIAL>/<ruta>" --format markdown
```

---

## 3. Shortcuts / Aliases

<!-- /CHUNK -->
<!-- CHUNK: shortcuts -->
*(Define aliases cortos para queries y patrones frecuentes.)*

| Shortcut | Expands To | Use Case |
|----------|------------|----------|
| `{{STACK_DB}}-tx` | transacción/transacción | Manejo de transacciones |
| `{{STACK_BACKEND}}-router` | rutas/endpoints | Definición de rutas |
| `{{STACK_FRONTEND}}-hook` | hook/patrón | Hooks y estado |
| `{{STACK_AUTH}}-token` | verificación de token | Auth |
| `{{STACK_VALIDATION}}-schema` | validación de esquema | Validación de entrada |

---

## 4. Copy-Ready Examples

<!-- /CHUNK -->
<!-- CHUNK: examples -->
*(Pega aquí ejemplos funcionales de tu stack.)*

### 4.1 {{STACK_BACKEND}} Setup
```{{LANG_BACKEND}}
// template de ejemplo
```

### 4.2 {{STACK_DB}} Query
```sql
-- template de ejemplo
```

---

## 5. Dev Commands

<!-- /CHUNK -->
<!-- CHUNK: commands -->
```bash
# Dev
{{DEV_COMMANDS}}
```

---

## 6. Quick Reference Card

| Need | Command |
|------|---------|
| (rellenar) | `webfetch "<URL>"` |

---

## Sources & Maintenance

- Actualiza cuando cambien versiones del stack (`package.json`, `*.lock`, etc.), surjan patrones nuevos, o la doc oficial se reestructure.
- Carga solo los chunks necesarios via `_skill-loader` para ahorrar tokens.

**Related:** `.agents/skills/*/SKILL.md` (autoskills autoinstaladas).

<!-- /CHUNK -->