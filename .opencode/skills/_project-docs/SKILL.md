---
name: _project-docs
description: |
  Documentación específica del proyecto consigliere. Carga bajo demanda via _skill-loader.
  Use when you need: official URLs, fetch patterns, shortcuts, and best practices for the consigliere stack.
chunks: [urls, patterns, shortcuts, examples, commands, communication]
metadata:
  version: 1.0.0
---

# consigliere — Project Documentation

> Harness CLI por proyecto — Node >=20.11 ESM (usa `import.meta.dirname`) + Bash/PowerShell + git/tar, memoria 3 capas md+grep, routing orgánico y SDD-lite.

## 1. Official URLs Table

<!-- CHUNK: urls -->
| Technology | Official Docs | API Reference | GitHub | Notes |
|------------|---------------|---------------|--------|-------|
| Node.js >=20.11 ESM (`import.meta.dirname`) | https://nodejs.org/docs/latest/api/ | https://nodejs.org/api/esm.html | https://github.com/nodejs/node | ESM native, node --check |
| opencode | https://opencode.ai/docs | https://opencode.ai/docs/cli | https://github.com/sst/opencode | TUI harness, agents/commands |
| npm advisor-harness | https://www.npmjs.com/package/advisor-harness | https://github.com/fcocampione-star/consigliere#readme | https://github.com/fcocampione-star/consigliere | v2.0.0 via npx advisor-harness@latest |
| Git SCM | https://git-scm.com/doc | https://git-scm.com/docs/git-init | https://github.com/git/git | git/tar backups keep 5 |
| Bash 4+ / PowerShell 5.1+ | https://www.gnu.org/software/bash/manual/ | https://learn.microsoft.com/en-us/powershell/ | https://git.savannah.gnu.org/cgit/bash.git | init.sh / init.ps1 |
| md+grep (memory-index, regex Node) | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions | https://nodejs.org/api/ | — | sin base de datos: Markdown + grep, cero dependencias |

<!-- /CHUNK -->

## 2. Fetch Patterns

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

<!-- /CHUNK -->
## 3. Shortcuts / Aliases

<!-- CHUNK: shortcuts -->
| Shortcut | Expands To | Use Case |
|----------|------------|----------|
| `/discover` | `node .opencode/scripts/doctor.mjs` + skill audit | Audita stack real vs declarado |
| `/routine` | routing orgánico direct/delegated + spec-lite ≤650w | Flujo explore→plan→critic→build→verify→record |
| `/doctor` | `node .opencode/scripts/doctor.mjs --json` | Diagnóstico del harness: opencode.json + harden, tamaños/topic de memoria, lock, hook, cache, scripts, directorios y derivados (exit 0 ok / 1 warnings / 2 errors) |
| `/record` | 6 campos Goal/Discoveries/Accomplished/Next/Files/Verificación + topic | Persistir memoria |
| `/review` | stale review_after +90d | Listar decisiones caducadas |
| `memory/search` | `node .opencode/scripts/memory-index.mjs search "query"` | Búsqueda md+grep |
| `skill/load` | `node .opencode/skills/_skill-loader/loader.mjs chunk "<skill>" urls,patterns` | Carga chunks bajo demanda |

---

<!-- /CHUNK -->

## 4. Copy-Ready Examples

<!-- CHUNK: examples -->
### 4.1 Harness install (Node ESM universal)
```bash
# Node >=20.11 es obligatorio en TODAS las vías: init.sh/init.ps1/init.cmd lanzan init.mjs vía Node
npx advisor-harness@latest /ruta/proyecto --name mi-app --stack-backend node/express --git yes
node init.mjs /tmp/demo --name demo
node init.mjs /tmp/demo --name demo                   # Windows/Unix; init.sh|init.cmd|init.ps1 son shims que delegan
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
# cache: .advisor/skill-registry.cache.json v2 (path+mtime+size) — se regenera sola
# bin: advisor + advisor-harness + alias consigliere-harness (1 versión transición)
```

### 4.4 Memory limits & sync
```bash
bash scripts/check-memory-limits.sh
powershell -NoProfile -File ./scripts/check-memory-limits.ps1
node .opencode/scripts/memory-sync.mjs status
node .opencode/scripts/memory-sync.mjs export --all
node .opencode/scripts/doctor.mjs --json
```

---

<!-- /CHUNK -->

## 5. Dev Commands

<!-- CHUNK: commands -->
```bash
# Dev — harness CLI por proyecto (Node >=20.11, ver .nvmrc)
npm test                                              # suite completa: node --check + test/ + rotación + contrato + versión
npm run test:unit                                    # solo la suite de test/ (micro-framework sin deps)
npm run test:contract                                # contrato anti-drift (paridad espejo raíz↔templates/ + catálogos)
npm run lint:sh                                      # bash -n init.sh + scripts/check-memory-limits.sh (lint-sh.mjs resuelve el bash: PATH → Git for Windows; override ADVISOR_BASH)
npm run lint:ps1                                     # parse AST de PowerShell sobre init.ps1
npm run version:check                                # versión única: package.json == init.mjs/init.sh/init.ps1 + las 2 SKILL.md de _project-docs
node --check init.mjs && node --check .opencode/scripts/doctor.mjs  # validación ESM syntax
node .opencode/scripts/doctor.mjs --json              # diagnóstico harness (exit 0 ok / 1 warnings / 2 errors)
node .opencode/skills/_skill-loader/loader.mjs list --json  # listar skills (cache fingerprint)
node .opencode/scripts/memory-index.mjs search "query"      # búsqueda memoria md+grep
node .opencode/scripts/memory-sync.mjs status         # estado sync local chunks
bash scripts/check-memory-limits.sh                   # límites 100/150 líneas (PROJECT_STATE/SUMMARY)
powershell -NoProfile -File ./scripts/check-memory-limits.ps1   # límites 100/150 líneas (Windows)
node init.mjs /tmp/demo --name demo                   # probar instalador universal
```

### Modelos: free tier de opencode

Si un agente falla con `Error: OpenCode's free tier can only be used from within OpenCode`, **no es un fallo del harness**: opencode exige que la petición venga de su propio cliente (`User-Agent: opencode/<semver>` + cabecera `x-opencode-session`). El harness solo valida la forma de un id de modelo (`MODEL_RE`), nunca su entitlement, así que el error aparece al ejecutar el modelo, no al configurarlo. Mitigaciones: un modelo que no sea del free tier para ese agente, o `opencode auth login`. No lo resuelvas parcheando el harness (ver § "Modelos del free tier" del README).
<!-- /CHUNK -->

## 6. Quick Reference Card

| Need | Command |
|------|---------|
| doctor | `node .opencode/scripts/doctor.mjs --json` |
| list skills | `node .opencode/skills/_skill-loader/loader.mjs list --json` |
| search memoria | `node .opencode/scripts/memory-index.mjs search "query"` |
| check límites | `bash scripts/check-memory-limits.sh` · `powershell -NoProfile -File ./scripts/check-memory-limits.ps1` |

---

## 7. Comunicación adaptativa

<!-- CHUNK: communication -->
Referencia rápida para builder/planner/critic: el advisor fija el modo de comunicación (session-scoped, `/modo`) y lo propaga en cada prompt delegado.

| Modo | Cuándo (señal) | Tono en respuestas |
|------|----------------|--------------------|
| **educador** | prompt vago/simple/error conceptual | guía con pasos claros, contexto amplio y el "por qué"; analogías solo bajo demanda o desbloqueo |
| **practicante** | técnico sin criterios | criterios + alternativas breves, decisión razonada al usuario |
| **copiloto** | experto/urgente/detalle + "solo hazlo" | ejecución directa, solo decisiones de diseño no obvias |

**Regla de brevedad**: ≤2-3 frases salvo que el modo/tarea lo justifique. Nunca repetir educación ya dada; un `/modo` explícito gana sobre señales; no escribir memoria ni `opencode.json` para persistir el modo (solo sesión).
<!-- /CHUNK: communication -->

## Sources & Maintenance

- Actualiza cuando cambien versiones del stack (`package.json`, `*.lock`, etc.), surjan patrones nuevos, o la doc oficial se reestructure.
- Carga solo los chunks necesarios via `_skill-loader` para ahorrar tokens.

**Related:** `.agents/skills/*/SKILL.md` (autoskills autoinstaladas).
