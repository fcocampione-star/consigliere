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

> Harness CLI por proyecto — Node >=18 ESM + Bash/PowerShell + git/tar, memoria 3 capas md+grep, routing orgánico y SDD-lite.

## 1. Official URLs Table

<!-- CHUNK: urls -->
| Technology | Official Docs | API Reference | GitHub | Notes |
|------------|---------------|---------------|--------|-------|
| Node.js >=18 ESM | https://nodejs.org/docs/latest/api/ | https://nodejs.org/api/esm.html | https://github.com/nodejs/node | ESM native, node --check |
| opencode | https://opencode.ai/docs | https://opencode.ai/docs/cli | https://github.com/sst/opencode | TUI harness, agents/commands |
| npm advisor-harness | https://www.npmjs.com/package/advisor-harness | https://github.com/fcocampione-star/consigliere#readme | https://github.com/fcocampione-star/consigliere | v2.0.0 via npx advisor-harness@latest |
| Git SCM | https://git-scm.com/doc | https://git-scm.com/docs/git-init | https://github.com/git/git | git/tar backups keep 5 |
| Bash 4+ / PowerShell 5.1+ | https://www.gnu.org/software/bash/manual/ | https://learn.microsoft.com/en-us/powershell/ | https://git.savannah.gnu.org/cgit/bash.git | init.sh / init.ps1 |
| grep + perl (memory-index) | https://www.gnu.org/software/grep/manual/ | https://perldoc.perl.org/perlre | — | md+grep sin SQLite fallback |

<!-- /CHUNK -->
<!-- CHUNK: patterns -->
Use `webfetch` con estas queries para documentación en vivo.

### Node.js ESM + node --check
```bash
webfetch "https://nodejs.org/api/esm.html" --format markdown
```

### opencode agents & commands
```bash
webfetch "https://opencode.ai/docs" --format markdown
```

### npm advisor-harness registry
```bash
webfetch "https://www.npmjs.com/package/advisor-harness" --format markdown
```

### Git SCM + tar backups
```bash
webfetch "https://git-scm.com/doc" --format markdown
```

### Bash manual / PowerShell docs
```bash
webfetch "https://www.gnu.org/software/bash/manual/" --format markdown
```

---

## 3. Shortcuts / Aliases

<!-- /CHUNK -->
<!-- CHUNK: shortcuts -->
| Shortcut | Expands To | Use Case |
|----------|------------|----------|
| `/discover` | `node .opencode/scripts/doctor.mjs` + skill audit | Audita stack real vs declarado |
| `/routine` | routing orgánico direct/delegated + spec-lite ≤650w | Flujo explore→plan→critic→build→verify→record |
| `/doctor` | `node .opencode/scripts/doctor.mjs --json` | Diagnóstico 16-17 checks (variable por condicionales §2/topic/manifest/index) |
| `/record` | 5 campos Goal/Discoveries/Accomplished/Next/Files + topic | Persistir memoria |
| `/review` | stale review_after +90d | Listar decisiones caducadas |
| `memory/search` | `node .opencode/scripts/memory-index.mjs search "query"` | Búsqueda md+grep |
| `skill/load` | `node .opencode/skills/_skill-loader/loader.mjs chunk "<skill>" urls,patterns` | Carga chunks bajo demanda |

---

## 4. Copy-Ready Examples

<!-- /CHUNK -->
<!-- CHUNK: examples -->
### 4.1 Harness install (Node ESM universal)
```bash
npx advisor-harness@latest /ruta/proyecto --name mi-app --stack-backend node/express --git yes
node init.mjs /tmp/demo --name demo
bash init.sh --dir /tmp/demo --name demo
```

### 4.2 Memory search (md+grep)
```bash
node .opencode/scripts/memory-index.mjs search "harness"
node .opencode/scripts/memory-index.mjs timeline <id>
node .opencode/scripts/memory-index.mjs get <id>
```

### 4.3 Skill loader cache fingerprint
```bash
node .opencode/skills/_skill-loader/loader.mjs list --json
node .opencode/skills/_skill-loader/loader.mjs chunk "_project-docs" urls,shortcuts,examples
node .opencode/skills/_skill-loader/loader.mjs refresh --force
# cache: .advisor/skill-registry.cache.json v2 (path+mtime+size), fallback lectura legacy .consigliere/
# bin: advisor + advisor-harness + alias consigliere-harness (1 versión transición)
```

### 4.4 Memory limits & sync
```bash
bash scripts/check-memory-limits.sh
node .opencode/scripts/memory-sync.mjs status
node .opencode/scripts/memory-sync.mjs export --all
node .opencode/scripts/doctor.mjs --json
```

---

## 5. Dev Commands

<!-- /CHUNK -->
<!-- CHUNK: commands -->
```bash
# Dev — harness CLI por proyecto
npm test                                              # node --check init.mjs + loader + doctor + memory scripts
node --check init.mjs && node --check .opencode/scripts/doctor.mjs  # validación ESM syntax
node .opencode/scripts/doctor.mjs --json              # diagnóstico harness (16-17 checks, variable por condicionales §2/topic/manifest/index)
node .opencode/skills/_skill-loader/loader.mjs list --json  # listar skills (cache fingerprint)
node .opencode/scripts/memory-index.mjs search "query"      # búsqueda memoria md+grep
node .opencode/scripts/memory-sync.mjs status         # estado sync local chunks
bash scripts/check-memory-limits.sh                   # límites 100/150 líneas (PROJECT_STATE/SUMMARY)
node init.mjs /tmp/demo --name demo                   # probar instalador universal
```

---

## 6. Quick Reference Card

| Need | Command |
|------|---------|
| doctor 16-17 | `node .opencode/scripts/doctor.mjs --json` |
| list skills | `node .opencode/skills/_skill-loader/loader.mjs list --json` |
| search memoria | `node .opencode/scripts/memory-index.mjs search "query"` |
| check límites | `bash scripts/check-memory-limits.sh` |

---

## Sources & Maintenance

- Actualiza cuando cambien versiones del stack (`package.json`, `*.lock`, etc.), surjan patrones nuevos, o la doc oficial se reestructure.
- Carga solo los chunks necesarios via `_skill-loader` para ahorrar tokens.

**Related:** `.agents/skills/*/SKILL.md` (autoskills autoinstaladas).

<!-- /CHUNK -->
