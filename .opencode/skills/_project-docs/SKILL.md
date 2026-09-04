---
name: _project-docs
description: |
  Documentación específica del proyecto consigliere. Carga bajo demanda via _skill-loader.
  Use when you need: official URLs, fetch patterns, shortcuts, and best practices for the consigliere stack.
chunks: [urls, patterns, shortcuts, examples, commands]
metadata:
  version: 1.0.0
---

# consigliere — Project Documentation

> Plantilla de documentación del stack. **Edita este archivo** para completar URLs, shortcuts, patrones y ejemplos de tu stack real.

## 1. Official URLs Table

<!-- CHUNK: urls -->
| Technology | Official Docs | API Reference | GitHub | Notes |
|------------|---------------|---------------|--------|-------|
|  | | | | |
|  | | | | |
|  | | | | |
|  | | | | |
|  | | | | |
|  | | | | |

*(Rellena cada fila con la URL oficial de docs, API ref y GitHub.)*

---

## 2. Fetch Patterns (Common Queries)

<!-- /CHUNK -->
<!-- CHUNK: patterns -->
Use `webfetch` con estas queries para documentación en vivo. *(Edita según tu stack.)*

### 
```bash
webfetch "<URL_OFFICIAL>/<ruta>" --format markdown
```

### 
```bash
webfetch "<URL_OFFICIAL>/<ruta>" --format markdown
```

### 
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
| `-tx` | transacción/transacción | Manejo de transacciones |
| `-router` | rutas/endpoints | Definición de rutas |
| `-hook` | hook/patrón | Hooks y estado |
| `-token` | verificación de token | Auth |
| `-schema` | validación de esquema | Validación de entrada |

---

## 4. Copy-Ready Examples

<!-- /CHUNK -->
<!-- CHUNK: examples -->
*(Pega aquí ejemplos funcionales de tu stack.)*

### 4.1  Setup
```typescript
// template de ejemplo
```

### 4.2  Query
```sql
-- template de ejemplo
```

---

## 5. Dev Commands

<!-- /CHUNK -->
<!-- CHUNK: commands -->
```bash
# Dev

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