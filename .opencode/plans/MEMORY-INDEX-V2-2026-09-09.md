# MEMORY-INDEX-V2 — Índice derivado + Manifest ligero (Opción A)

> **Plan futuro — no ejecutar aún.** Autocontenido para builder/planner.

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-09 |
| **Topic** | `architecture/memory-index-v2` |
| **Estado** | `draft` |
| **Autor** | `orchestrator` |
| **Versión harness** | `2.0.0` |
| **Decisión base** | Opción A aprobada vs B SQLite / C embeddings / D híbrido |
| **Restricción** | Harness-only `Node>=18 ESM` sin DB — `PROJECT_STATE.md:19`, `AGENTS.md:32` |
| **No tocar** | `PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/`, `.memory-lock` |

---

## 1. Resumen ejecutivo — por qué A gana

Opción A (manifest <80 tokens + índice derivado JSON regenerado en escritura) preserva `md+grep` sin introducir dependencia nativa ni proceso background. vs **B SQLite** — añade binario `sqlite3` opcional, migraciones y harden bash; vs **C embeddings** — requiere modelo/vector store y >2k tokens por query; vs **D híbrido** — duplica complejidad (SQL+vectors) y rompe `harness-only`. A cuesta ~150 LOC, genera índice en `<30ms` para 74L `SUMMARY.md:74` + 62L `PROJECT_STATE.md:62`, y reduce acceso rápido de `~1850→550 tokens` manteniendo `fingerprint mtime+size` probado en `loader.mjs:48`.

---

## 2. Diagnóstico resumido D1-D8 (refs file:line)

| ID | Hallazgo | Ref | Impacto |
|----|----------|-----|---------|
| **D1** | `PROJECT_STATE.md` capa 0 siempre cargado crece a 62L sin manifest; cada `/discover` debe `read` completo para 3 decisiones | `PROJECT_STATE.md:62`, `PROJECT_STATE.md:19-22` | +300 tokens por turno orchestrator |
| **D2** | `allEntries()` re-parsea `SUMMARY.md` + todo `CHANGELOG/` + `§2` en cada `search` — O(n) sin cache | `memory-index.mjs:42-63` | search ~80ms con 10 archivos, sin ranking |
| **D3** | Ranking ingenuo `includes(q)` sin peso recency/topic/title; `preview slice(1,5)` fijo | `memory-index.mjs:70-72`, `memory-index.mjs:37` | resultados no ordenados, ruido |
| **D4** | Sin manifest ligero: no hay vista `<15 líneas` para `orchestrator §1` — debe elegir entre 62L o 0 contexto | falta `.consigliere/memory-manifest.json` | ~1850 tokens si carga SUMMARY |
| **D5** | Hook rota **solo 1 entry** por commit vía `perl -0777` single-match | `post-commit-memory-rotate.sh:60-73` | `SUMMARY >150L` requiere N commits para drenar |
| **D6** | `memory-sync.mjs:26` `exportChunks()` escribe `.consigliere/chunks/<monday>.json` desacoplado del índice; drift si `SUMMARY` cambia sin `export` | `memory-sync.mjs:26-48`, `memory-sync.mjs:76-86` | clone sin chunks pierde timeline |
| **D7** | Sin buffer de sesión: `/record` escribe directo a `SUMMARY.md` sin staging diario | `summarizer.md:48-72`, `SUMMARY.md:52-64` | ediciones concurrentes + difícil squash |
| **D8** | `doctor.mjs` 14 checks no cubre manifest/index frescura ni session | `doctor.mjs:1-89` (14 checks), `doctor.mjs:79-88` exit codes | regresión silenciosa v2 |

> No tocar memoria persistente: `SUMMARY.md` 74L y `PROJECT_STATE 62L` son datos; v2 solo añade derivados en `.consigliere/`.

---

## 3. Diseño detallado Opción A

### 3.1 Artefactos derivados (git-ignorables excepto manifest opcional)

```
.consigliere/
├── memory-manifest.json          # ligero, <15 líneas, commiteable opcional
├── memory-index.json             # derivado completo, git-ignored, regenerable
├── skill-registry.cache.json     # existente loader.mjs:28
├── session/
│   └── YYYY-MM-DD.md             # buffer diario (append, merge on /record)
├── chunks/                       # existente memory-sync.mjs:14
└── backups/                      # existente init.mjs:27
```

`.gitignore` añadirá `memory-index.json` y `session/` (manifest queda versionable a elección).

### 3.2 `memory-manifest.json` — <15 líneas, <80 tokens

```json
{
  "version": 1,
  "generatedAt": "2026-09-09T10:00:00.000Z",
  "fingerprint": { "state": "m:1725900000000 s:3200", "summary": "m:1725900000000 s:4800" },
  "counts": { "stateDecisions": 3, "recentEntries": 5, "archivedWeeks": 0 },
  "recent": [
    { "id": "2026-09-04--fix-docs-instaladores", "topic": "dx/docs-fix-consigliere-init", "date": "2026-09-04" },
    { "id": "2026-09-04--fix-gap-upgrade", "topic": "architecture/upgrade-preserve", "date": "2026-09-04" }
  ],
  "stale": []
}
```

Reglas: `version MUST ===1`, `recent` max 5, orden desc `date`, `stale` = decisiones `review_after < today` de `PROJECT_STATE.md:19-22`.

### 3.3 `memory-index.json` — índice derivado completo

```json
{
  "version": 1,
  "generatedAt": "2026-09-09T10:00:00.000Z",
  "fingerprint": {
    "state": { "mtime": 1725900000000, "size": 3200, "path": "PROJECT_STATE.md" },
    "summary": { "mtime": 1725900000000, "size": 4800, "path": "SUMMARY.md" },
    "changelog": [{ "path": "CHANGELOG/2026-09-01.md", "mtime": 1725900000000, "size": 1200 }]
  },
  "entries": [
    {
      "id": "2026-09-04--fix-docs-instaladores",
      "date": "2026-09-04",
      "title": "Fix docs/instaladores: consigliere-init roto",
      "topic": "dx/docs-fix-consigliere-init",
      "source": "SUMMARY.md",
      "preview": "Goal: Cerrar 3 huecos ...",
      "score": 0.92
    }
  ]
}
```

Fingerprint idéntico patrón `loader.mjs:48-58` (`statSync().mtimeMs + size`). `score` computado solo en `search`, no persistido (o persistido como `baseScore` recency).

### 3.4 Fingerprint y ranking

**Fingerprint** — `fingerprint()` en `memory-index.mjs` nuevo:

```js
function fingerprint() {
  const fp = {};
  for (const p of [STATE, SUMMARY]) { const st=statSync(p); fp[basename(p)]={mtime:st.mtimeMs, size:st.size}; }
  for (const f of readdirSync(CHANGELOG_DIR).filter(f=>f.endsWith('.md'))) {
    const st=statSync(join(CHANGELOG_DIR,f)); fp[`CHANGELOG/${f}`]={mtime:st.mtimeMs,size:st.size};
  }
  return fp;
}
function isFresh(cached){
  if(!cached?.fingerprint) return false;
  const cur=fingerprint();
  return JSON.stringify(cur)===JSON.stringify(cached.fingerprint);
}
```

Cache válida si `JSON.stringify` idéntico — mismo contrato `loader.mjs:77-86` `isCacheValid`.

**Ranking** — `score = 0.6*recency + 0.3*topic + 0.1*title`

```js
function score(entry, query, now=Date.now()){
  const q=query.toLowerCase();
  const recency = 1 - Math.min(1, (now - Date.parse(entry.date||'1970-01-01'))/ (30*864e5)); // 30d decay
  const topic = (entry.topic||'').toLowerCase().includes(q) ? 1 : 0;
  const title = (entry.title||'').toLowerCase().includes(q) ? 1 : ((entry.preview||'').toLowerCase().includes(q)?0.5:0);
  return 0.6*recency + 0.3*topic + 0.1*title;
}
```

Ordenar `hits.sort((a,b)=>b.score-a.score)` antes de print/json.

### 3.5 Generación en escritura, no lectura

| Evento | Acción | Archivo fuente |
|--------|--------|----------------|
| `summarizer` escribe `SUMMARY.md`/`PROJECT_STATE.md` | `node memory-sync.mjs buildManifest && buildIndex` | `memory-sync.mjs:26` extendido |
| `post-commit` hook | `buildManifest && buildIndex` tras rotación | `post-commit-memory-rotate.sh:82-84` |
| `memory-index.mjs search` | si `!isFresh()` → fallback md grep (D2) + warn `stale` | `memory-index.mjs:42` |
| `clone` sin derivados | `doctor` avisa + `search` funciona sin JSON | `doctor.mjs` check 15/16 |

Nunca bloquear lectura por falta de índice.

### 3.6 Session buffer `session/YYYY-MM-DD.md`

- Formato idéntico entrada `SUMMARY.md:52-64` pero sin `##` global; append-only.
- `/record` hace `merge`: `session/*.md` → `SUMMARY.md` top + `buildManifest/buildIndex` + truncate session.
- `memory-index.mjs search` incluye `session/` si existe (peso recency 1.0).

---

## 4. Flujo acceso rápido antes/después

**Antes (actual md+grep):**

```
orchestrator §1 → read PROJECT_STATE.md 62L (~950 tokens)
                → opcional read SUMMARY.md 74L (~900 tokens)
                → search re-parsea 42-63 en cada query
Total ~1850 tokens para contexto + search
```

**Después (A manifest+índice):**

```
orchestrator §1 → read .consigliere/memory-manifest.json 12L (~70 tokens)
                → si necesita detalle: search "topic" → memory-index.json (score rankeado)
                → solo on-demand: read SUMMARY.md / get <id>
Total ~550 tokens (-70%) para el 90% de turnos; full ~950 solo si get
```

Medición: `wc -l .consigliere/memory-manifest.json` MUST `<15` (`C4`), `token ≈ lines*6` estimado.

---

## 5. Cambios por archivo (11 files) — sin tocar memoria persistente

| # | Archivo | Cambio | Tipo |
|---|---------|--------|------|
| 1 | `.opencode/scripts/memory-index.mjs` | **v2**: añade `fingerprint()/isFresh()/score()`, lee `memory-index.json` primero, fallback `allEntries()` `memory-index.mjs:42`, ranking `0.6/0.3/0.1`, flag `--refresh`, salida `score` en `--json` | edit |
| 2 | `.opencode/scripts/memory-sync.mjs` | añade `buildManifest()` (<15L) + `buildIndex()` (full), `export` llama ambos, nuevo `status` muestra `manifest fresh? index fresh?` | edit |
| 3 | `.opencode/hooks/post-commit-memory-rotate.sh` | **batch loop**: `while LINES>150` rotar todas necesarias `post-commit-memory-rotate.sh:52-60`, tras loop `node memory-sync.mjs export` → manifest+index, actualizar `.consigliere/session/` prune | edit |
| 4 | `.opencode/scripts/doctor.mjs` | **checks 15/16**: `15 manifest fresh (<15L, fingerprint válido)` + `16 index fresh (fingerprint vs mtime+size)`; total `16/16` | edit |
| 5 | `.opencode/agents/summarizer.md` | tras escribir `SUMMARY.md:56-72` ejecutar `node memory-sync.mjs buildManifest && buildIndex`; respetar `AGENTS.md:16` lock `.memory-lock` | edit |
| 6 | `.opencode/agents/orchestrator.md` | §1 leer `memory-manifest.json` primero, fallback `PROJECT_STATE.md:62` si falta; documentar `550 tokens` vs `1850` | edit |
| 7 | `.opencode/plans/MEMORY-SYSTEM.md` | añadir § "Índice derivado + Manifest" con diagrama artefactos, fingerprint, ranking, session | edit |
| 8 | `templates/PROJECT_STATE.md` | no tocar instancia viva; actualizar template para incluir referencia manifest en §6 índices | edit (template) |
| 9 | `templates/AGENTS.md` | idem: documentar `memory-manifest.json` en capa 0.5 | edit (template) |
| 10 | `scripts/check-memory-limits.sh` | añadir check `manifest <15L` y `index fresh` warning | edit |
| 11 | `.gitignore` | añadir `/.consigliere/memory-index.json` + `/.consigliere/session/` (manifest queda trackeable) | edit |

> `init.mjs:432` `PRESERVED` ya cubre `PROJECT_STATE.md/SUMMARY.md`; añadir `memory-manifest.json` a `BACKUP_ITEMS` opcional pero no a `PRESERVED` (derivado regenerable). `init.mjs:28` `BACKUP_ITEMS` + `init.mjs:27`.

---

## 6. Spec-lite RFC2119 + Given/When/Then (≤650 palabras)

**Keywords**: `MUST`, `MUST NOT`, `SHOULD`, `MAY` según RFC2119.

### Requisitos

- **R1 Manifest**: El sistema `MUST` generar `.consigliere/memory-manifest.json` con `version:1`, `fingerprint mtime+size`, `recent[≤5]`, `stale[]` en cada escritura de memoria.
- **R2 Índice**: `MUST` generar `.consigliere/memory-index.json` derivado con mismo `fingerprint` que `loader.mjs:48`; `SHOULD` regenerar en `<50ms` para `<200 entradas`.
- **R3 Ranking**: `search` `MUST` rankear por `0.6 recency +0.3 topic +0.1 title` cuando `index fresh`; `MUST` fallback a `includes` si stale.
- **R4 Batch**: Hook `MUST` rotar en loop hasta `SUMMARY <150L` (`post-commit-memory-rotate.sh:52`), no solo 1 entry.
- **R5 Session**: `session/YYYY-MM-DD.md` `MUST` hacer merge on `/record` y `SHOULD` incluirse en `search` con recency 1.0.
- **R6 Fallback**: Si `memory-index.json` stale o ausente, `MUST` servir `allEntries()` md+grep sin error.

### Criterios Given/When/Then

**C1 fingerprint válido**
- *Given* `PROJECT_STATE.md` 62L y `SUMMARY.md` 74L con `mtime` conocidos
- *When* `node memory-sync.mjs buildIndex && cat .consigliere/memory-index.json | jq .fingerprint`
- *Then* `fingerprint.summary.mtime === stat -c %Y SUMMARY.md` y `size === wc -c`, y `isFresh()` retorna `true` hasta próximo write.

**C2 search rankea recency**
- *Given* 2 entradas `topic:arch/auth` con fechas `2026-09-09` y `2026-08-01`
- *When* `node memory-index.mjs search "arch/auth" --json | jq .[0].id`
- *Then* `id` `MUST` ser `2026-09-09` primero (`score` mayor por recency 0.6) y `score` presente en JSON.

**C3 batch rotation >150**
- *Given* `SUMMARY.md` con 180L (6 entradas)
- *When* `git commit --allow-empty -m "test"` dispara `post-commit-memory-rotate.sh:52`
- *Then* `wc -l SUMMARY.md` `MUST` ser `<150` y `CHANGELOG/<monday>.md` `MUST` contener `≥2` entradas movidas, y `memory-manifest.json` actualizado.

**C4 manifest <15 líneas (<80 tokens)**
- *Given* repo con 5 entradas recientes
- *When* `wc -l .consigliere/memory-manifest.json && wc -c`
- *Then* líneas `MUST` `<15` y `recent.length MUST ≤5` y `version MUST ===1`.

**C5 fallback md si JSON stale**
- *Given* `memory-index.json` con fingerprint viejo (editar `mtime` a 0)
- *When* `node memory-index.mjs search "query" --json`
- *Then* `MUST` retornar hits vía `allEntries()` `memory-index.mjs:42` y `stderr` `SHOULD` contener `stale` warning, exit `0`.

**C6 session buffer merge on /record**
- *Given* `.consigliere/session/2026-09-09.md` con 1 entrada `topic: test/session`
- *When* `summarizer` ejecuta merge (`/record` o `node memory-sync.mjs buildManifest`)
- *Then* `SUMMARY.md` `MUST` contener entrada al inicio, `session/2026-09-09.md` `MUST` truncarse o moverse, y `memory-index.json` `MUST` incluir entrada con `source: session`.

---

## 7. Tasks checklist secuenciado

### Fase 0 — Spec-lite (≤650w) — ya cubierto §6
- [ ] Validar spec C1-C6 con `orchestrator` + `critic` (arquitectura `harness-only` `AGENTS.md:32`)
- **Verificación**: `wc -w` spec-lite `<650`, `node --check` sin cambios aún

### Fase 1 — Core (memory-index v2 + memory-sync manifest/index)
- [ ] Editar `memory-index.mjs`: `fingerprint()`, `isFresh()`, `score()`, `loadIndex()`, `search` con ranking + fallback `allEntries():42`, flag `--refresh`
- [ ] Editar `memory-sync.mjs:26`: `buildManifest()` + `buildIndex()` + `status` extendido; `export` llama ambos
- [ ] Crear `.consigliere/session/` dir + `.gitkeep`
- **Verificación Fase1**:
  ```bash
  node --check .opencode/scripts/memory-index.mjs
  node --check .opencode/scripts/memory-sync.mjs
  npm test
  node .opencode/scripts/memory-sync.mjs buildManifest && cat .consigliere/memory-manifest.json | wc -l  # <15
  node .opencode/scripts/memory-sync.mjs buildIndex && node .opencode/scripts/memory-index.mjs search "architecture" --json | jq length
  ```

### Fase 2 — Hook batch + Doctor 16/16
- [ ] Editar `post-commit-memory-rotate.sh:52-86`: `while LINES>150 || FIRST < THIS_MONDAY` loop, `perl -0777` extraído en función `rotate_one()`, post-loop `node memory-sync.mjs buildManifest && buildIndex`
- [ ] Editar `doctor.mjs`: checks 15 `manifest fresh` + 16 `index fresh`, actualizar total `14→16`, `fix` hints
- [ ] Editar `scripts/check-memory-limits.sh:27-51`: añadir `manifest <15L` check
- [ ] Editar `.gitignore:39-45`: `/.consigliere/memory-index.json` + `/.consigliere/session/`
- **Verificación Fase2**:
  ```bash
  node --check .opencode/scripts/doctor.mjs
  bash -n .opencode/hooks/post-commit-memory-rotate.sh
  bash scripts/check-memory-limits.sh
  node .opencode/scripts/doctor.mjs --json | jq '.checks | length'  # 16
  node .opencode/scripts/doctor.mjs --json | jq '.checks[] | select(.name|contains("manifest") or contains("index"))'
  ```

### Fase 3 — Session / Docs / Agents
- [ ] Editar `summarizer.md:48-72`: tras `mkdir .memory-lock` + write, `node memory-sync.mjs buildManifest && buildIndex` antes de `rmdir`
- [ ] Editar `orchestrator.md:34-42`: leer `memory-manifest.json` primero, tabla before/after tokens `1850→550`
- [ ] Editar `.opencode/plans/MEMORY-SYSTEM.md:1-85`: añadir § índice derivado, fingerprint, ranking, session
- [ ] Sincronizar `templates/` espejos (`PROJECT_STATE.md`, `AGENTS.md`) si aplica
- **Verificación Fase3**:
  ```bash
  node --check .opencode/scripts/memory-index.mjs && node --check .opencode/scripts/memory-sync.mjs
  cat .opencode/agents/orchestrator.md | grep -c "memory-manifest"  # >=1
  cat .opencode/agents/summarizer.md | grep -c "buildManifest"  # >=1
  ```

### Fase 4 — Dogfooding + Upgrade preservado
- [ ] Probar en `/tmp/demo` `node init.mjs /tmp/demo --name demo` → `doctor --json 16/16`, `search --json` rankeado
- [ ] Validar `init.mjs:432` `PRESERVED` no pisa manifest derivado; `BACKUP_ITEMS` keep 5 incluye derivados sin romper `--upgrade` `init.mjs:393-437`
- [ ] Métrica tokens: `wc -l` manifest `<15`, `node memory-index.mjs search "sdd"` latency `<50ms`
- **Verificación Fase4**:
  ```bash
  node init.mjs /tmp/demo-v2 --name demo-v2 --git no --autoskills 3
  node /tmp/demo-v2/.opencode/scripts/doctor.mjs --json | jq '.checks'
  node /tmp/demo-v2/.opencode/scripts/memory-index.mjs search "test" --json | head -20
  node init.mjs /tmp/demo-v2 --upgrade --dry-run  # debe listar backup sin pisar PROJECT_STATE
  rm -rf /tmp/demo-v2
  ```

---

## 8. Riesgos y mitigaciones

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| **Drift derivados vs md** | Alta | `isFresh()` `mtime+size` como `loader.mjs:77`; `search` fallback md si stale (C5); `build` en cada escritura, no lectura |
| **Hook perl frágil** | Media | Extraer `rotate_one()` testeable; `bash -n` + `perl -0777` con `set -euo pipefail` ya en `post-commit-memory-rotate.sh:10`; añadir `shellcheck` en verifier |
| **Clone sin chunks/index** | Media | `doctor` check 15/16 avisa; `search` funciona sin JSON; `memory-sync.mjs import` restaura `CHANGELOG/`; manifest regenerable `buildManifest` |
| **Hábito orchestrator ignora manifest** | Media | Documentar en `orchestrator.md §1` lectura manifest primero; `verifier` chequea `grep -c manifest`; métrica `1850→550` visible |
| **Session buffer huérfano** | Baja | `prune` session >7d en `buildManifest`; `.gitignore` evita commit; `doctor` avisa `session/*.md` >5 archivos |
| **Upgrade pisa derivados** | Baja | `init.mjs:432` `PRESERVED` solo `PROJECT_STATE/SUMMARY/opencode.json/AGENTS/.gitignore`; derivados en `.consigliere/` ya en `BACKUP_ITEMS:27` keep 5, regenerables tras upgrade |

---

## 9. Verificación final (copy-paste)

```bash
# 0 syntax
node --check .opencode/scripts/memory-index.mjs && node --check .opencode/scripts/memory-sync.mjs && node --check .opencode/scripts/doctor.mjs && echo "syntax OK"

# 1 manifest
node .opencode/scripts/memory-sync.mjs buildManifest
wc -l .consigliere/memory-manifest.json          # MUST <15
cat .consigliere/memory-manifest.json | jq .     # version 1, recent ≤5

# 2 index + ranking C1 C2 C5
node .opencode/scripts/memory-sync.mjs buildIndex
node .opencode/scripts/memory-index.mjs search "architecture" --json | jq '.[0] | {id, topic, score}'
node .opencode/scripts/memory-index.mjs search "sdd" --json | head -20
# stale fallback: editar fingerprint mtime a 0 y re-search debe seguir funcionando
jq '.fingerprint.summary.mtime=0' .consigliere/memory-index.json > /tmp/stale.json && cp /tmp/stale.json .consigliere/memory-index.json
node .opencode/scripts/memory-index.mjs search "arch" --json  # MUST retornar hits con warning

# 3 batch rotation C3
bash -n .opencode/hooks/post-commit-memory-rotate.sh
wc -l SUMMARY.md                                 # <150 tras commit

# 4 doctor 16/16 C4
node .opencode/scripts/doctor.mjs --json | jq '.checks | length'  # 16
node .opencode/scripts/doctor.mjs --json

# 5 limits
bash scripts/check-memory-limits.sh

# 6 session C6
mkdir -p .consigliere/session && echo "## 2026-09-09 — Test session\n\ntopic: test/session\n**Goal:** x" > .consigliere/session/2026-09-09.md
node .opencode/scripts/memory-index.mjs search "test/session" --json | jq length  # >=1
rm .consigliere/session/2026-09-09.md

# 7 npm test
npm test
```

---

## 10. No-go / fuera de alcance

- No editar `PROJECT_STATE.md`, `SUMMARY.md`, `CHANGELOG/` (datos vivos).
- No tocar `.memory-lock` manual.
- No añadir `sqlite3`, embeddings ni deps nativas.
- No proponer `git commit/push` (plan draft, `AGENTS.md:26` bash harden `git push → ask`).

---

*Plan generado 2026-09-09 — listo para `planner → critic → builder` cuando se priorice.*
