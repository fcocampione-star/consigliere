---
name: _skill-loader
description: |
  Skill de carga bajo demanda de otras skills. Permite listar skills disponibles, buscar por término y cargar solo chunks relevantes (urls, patterns, shortcuts, examples, commands) para ahorrar tokens.
  Use when: necesitas acceder a una skill de docs o autoskill sin cargar su contenido completo.
---

# Skill Loader

Carga skills de documentación bajo demanda para minimizar el uso de contexto/tokens.

## Ubicaciones de skills

- **Proyecto**: `.opencode/skills/<nombre>/SKILL.md`
- **Autoskills**: `.agents/skills/<nombre>/SKILL.md`

## Funciones

Ejecuta el loader runtime (`loader.mjs`) con Node:

```bash
node .opencode/skills/_skill-loader/loader.mjs list
node .opencode/skills/_skill-loader/loader.mjs search "query"
node .opencode/skills/_skill-loader/loader.mjs load "skill-name"
node .opencode/skills/_skill-loader/loader.mjs chunk "skill-name" urls
node .opencode/skills/_skill-loader/loader.mjs chunk "skill-name" shortcuts,examples
```

- `list` — lista todas las skills disponibles (proyecto + autoskills).
- `search "<query>"` — busca skills/descripciones que contengan el término.
- `load "<skill>"` — imprime el frontmatter (nombre/descripción) + índice de chunks del skill.
- `chunk "<skill>" <chunks>` — imprime solo los chunks indicados (separados por coma).

## Formato de chunks en una SKILL.md

Los chunks se delimitan con comentarios HTML:

```markdown
<!-- CHUNK: urls -->
...contenido del chunk urls...
<!-- /CHUNK -->
```

## Flujo recomendado

1. `node ... list` — ver qué skills hay.
2. `node ... search "tema"` — localizar el skill relevante.
3. `node ... chunk "skill" urls,shortcuts,examples` — cargar solo lo necesario.
4. Aplica el patrón/ejemplo; usa `webfetch` para docs oficiales en vivo.

## Fallback

Si `loader.mjs` no se puede ejecutar (sin Node), usa `grep`/`read` directo sobre los SKILL.md correspondientes, cargando solo la sección que necesitas.
