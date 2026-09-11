---
name: _skill-loader
description: |
  Skill de carga bajo demanda de otras skills. Permite listar skills disponibles, buscar por término y cargar solo chunks relevantes (urls, patterns, shortcuts, examples, commands) para ahorrar tokens.
  Use when: necesitas acceder a una skill de docs o autoskill sin cargar su contenido completo.
chunks: [usage, chunks-format, flujo]
metadata:
  version: 1.0.0
---

# Skill Loader

Carga skills de documentación bajo demanda para minimizar el uso de contexto/tokens.

## 1. Uso

<!-- CHUNK: usage -->
Ubicaciones:

- **Proyecto**: `.opencode/skills/<nombre>/SKILL.md`
- **Autoskills**: `.agents/skills/<nombre>/SKILL.md`

Ejecuta el loader runtime (`loader.mjs`) con Node:

```bash
node .opencode/skills/_skill-loader/loader.mjs list [--refresh|--json]
node .opencode/skills/_skill-loader/loader.mjs refresh
node .opencode/skills/_skill-loader/loader.mjs search "query" [--json]
node .opencode/skills/_skill-loader/loader.mjs load "skill-name"
node .opencode/skills/_skill-loader/loader.mjs chunk "skill-name" urls
node .opencode/skills/_skill-loader/loader.mjs chunk "skill-name" shortcuts,examples
```

- `list [--refresh|--json]` — lista skills (usa cache `.advisor/skill-registry.cache.json` v2 fingerprint `path+mtime+size`, inspirado Gentle AI; fallback lectura legacy `.consigliere/`).
- `refresh` — fuerza regeneración del cache (también `list --refresh`).
- `search "<query>" [--json]` — busca skills/descripciones.
- `load "<skill>"` — frontmatter + índice chunks (+ avisos si `name` ≠ directorio o `chunks:` declara sin marcador).
- `chunk "<skill>" <chunks>` — solo chunks indicados (coma).
<!-- /CHUNK -->

## 2. Formato de chunks en una SKILL.md

<!-- CHUNK: chunks-format -->
Los chunks se delimitan con comentarios HTML, con el encabezado de sección fuera de los marcadores:

```markdown
## 1. Official URLs Table

<!-- CHUNK: urls -->
...contenido del chunk urls...
<!-- /CHUNK -->
```

Declara los chunks en el frontmatter (`chunks: [urls, patterns, ...]`); `loader.mjs load` avisa si `name` no coincide con el directorio o si un chunk declarado no tiene marcador.
<!-- /CHUNK -->

## 3. Flujo recomendado

<!-- CHUNK: flujo -->
1. `node ... list` — ver qué skills hay.
2. `node ... search "tema"` — localizar el skill relevante.
3. `node ... chunk "skill" urls,shortcuts,examples` — cargar solo lo necesario.
4. Aplica el patrón/ejemplo; usa `webfetch` para docs oficiales en vivo.
<!-- /CHUNK -->

## Notas

- Cache generada en `.advisor/skill-registry.cache.json` (v2 `path+mtime+size`); está ignorada por git (`.gitignore`), no commitear el inicial — se regenera con `refresh`.
- Mantener sincronizados los espejos raíz (`.opencode/skills/`) y `templates/.opencode/skills/` (solo cambian placeholders `{{PROJECT_NAME}}`); sin check doctor aún.
- Autoskill `bash-defensive-patterns` monolítica sin chunks: carga completa (full-load), no admite `chunk`.
- Si `loader.mjs` no se puede ejecutar (sin Node), usa `grep`/`read` directo sobre los SKILL.md correspondientes, cargando solo la sección que necesitas.
