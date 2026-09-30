/**
 * test/fixtures.mjs — generadores de fixtures de memoria para los tests.
 *
 * Los fixtures reproducen EXACTAMENTE lo que los scripts reales parsean, para
 * que un test no pueda pasar contra una forma que el motor real nunca ve.
 * Referencias (repo, líneas a la fecha de este archivo):
 *  - Marcadores de región: `<!-- ADVISOR:ENTRIES:START -->` / `...:END -->`,
 *    exportados como ENTRIES_START/ENTRIES_END en memory-stats.mjs:27-28 y
 *    validados por entriesRegion() (memory-stats.mjs:70-86) y por splitRegion()
 *    (memory-rotate.mjs:149-157). Deben aparecer 1/1 y en orden (contract-tests).
 *  - Heading de entrada: `## <YYYY-MM-DD> <sep> <título>` con separador en
 *    `[— - : |]` (HEAD_RE, memory-rotate.mjs:80) y variante tolerante con coma
 *    para LECTURA/índice (HEAD_TOLERANT_RE, memory-rotate.mjs:85). Los bloques
 *    se separan con UNA línea en blanco (appendToChangelog, memory-rotate.mjs:204).
 *  - Campos por entrada: `topic: <family/kebab>` y `review_after: YYYY-MM-DD`
 *    sobre línea propia (memory-index.mjs:67-68; manifest stale[] en
 *    memory-sync.mjs:167-171) + los 6 campos canónicos `**Goal:**` …
 *    `**Verificación:**` del bloque de entrada (summarizer.md; contract-tests §5).
 *  - PROJECT_STATE: §2 con decisiones `- <texto> [topic: x] review_after: YYYY-MM-DD`
 *    (stateDecisions(), memory-sync.mjs:149-155) y §4 con la tabla de índice
 *    semanal + fila separadora + placeholder `| (aún sin historial) |`
 *    (updateStateIndex, memory-rotate.mjs:270-289).
 *  - Pie de SUMMARY.md: el propio SUMMARY real empieza el índice archivado con
 *    `## Índice de historial archivado (CAPA 2)`, que EPILOGUE_RE
 *    (memory-rotate.mjs:89) reconoce como ancla de pie en modo fallback.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Marcador EXACTO del pie de SUMMARY.md que buscan los scripts reales, NO
// inventado: `> Cuando registres` es la primera ancla que prueba migrateMarkers
// para localizar el pie (memory-rotate.mjs:398) y la primera alternativa de
// EPILOGUE_RE (memory-rotate.mjs:89). La otra ancla real del pie,
// `## Índice de historial`, se usa más abajo en el propio SUMMARY de este repo.
export const FOOTER_MARK = '> Cuando registres';

// Marcadores de región: los MISMOS strings que memory-stats.mjs:27-28 exporta
// como ENTRIES_START / ENTRIES_END (validados por entriesRegion, memory-stats.mjs:70-86).
const ENTRIES_START = '<!-- ADVISOR:ENTRIES:START -->';
const ENTRIES_END = '<!-- ADVISOR:ENTRIES:END -->';

// Escapara de un cuerpo de entrada para que un `##` de ejemplo no se lea como
// heading (parseRegion es fence-aware, memory-rotate.mjs:108-128).
function block(text) {
  return String(text ?? '').replace(/\r?\n/g, '\n').trimEnd();
}

// PROJECT_STATE.md mínimo pero VÁLIDO: §2 con decisiones parseables y §4 con la
// tabla que updateStateIndex() completa tras la fila separadora.
const PROJECT_STATE = `# PROJECT_STATE — fixture (estado vivo del proyecto)

> **CAPA 0 del sistema de contexto.** Fixture de test.

---

## 1. Fase actual

| Fase | Descripción | Estado |
|------|-------------|--------|
| Fixture | Fixture de test | En curso |

---

## 2. Decisiones de diseño (append-only, consolidadas, con review_after)

- Decisión de fixture A [topic: test/fixture-a] review_after: 2099-12-31
- Decisión de fixture B [topic: test/fixture-b] review_after: 2099-12-31

---

## 3. Pendientes inmediatos

- [ ] Nada pendiente.

---

## 4. Índice de historial archivado (CAPA 2)

> \`CHANGELOG/YYYY-MM-DD.md\` — historial semanal archivado (nombrado por lunes).

| Semana (lunes) | Archivo | Resumen |
|----------------|---------|---------|
| (aún sin historial) | — | — |

> Decisiones superadas: \`CHANGELOG/DECISIONS-ARCHIVE.md\`.

---

## 5. Patrones de código (Code Patterns)

> Memoria de "cómo se hace X aquí" — reutilizable por planner/builder/critic.

| Patrón | Archivo/Ejemplo | Descripción |
|--------|-----------------|-------------|
| fixture | \`test/fixtures.mjs\` | Generador de fixtures de memoria |

---

## 6. Índices de búsqueda

- **Decisiones**: \`PROJECT_STATE.md §2\`.
`;

// Bloque de una entrada: heading + `topic:`/`review_after:` + 6 campos canónicos.
// Separador `-` del heading: forma canónica de HEAD_RE (memory-rotate.mjs:80),
// que admite `— - : |` (y `,` solo en la variante tolerante de lectura).
// `extra` añade líneas propias del test (fences, separadores alternos, etc.).
export function entry(date, title, body, extra = null) {
  return [
    `## ${date} - ${String(title).trim()}`,
    '',
    'topic: test/fixture',
    'review_after: 2099-12-31',
    `**Goal:** ${block(body) || 'sin objetivo'}`,
    '**Discoveries:** sin hallazgos.',
    '**Accomplished:** fixture de memoria.',
    '**Next:** revisar la rotación.',
    '**Files:** `git log --oneline -5`.',
    '**Verificación:** pendiente.',
    ...(extra ? ['', ...Array.isArray(extra) ? extra : [extra]] : []),
    '',
  ].join('\n');
}

// SUMMARY.md con la región delimitada por los marcadores + pie con la tabla de
// índice. `entries` va de más nueva a más antigua (orden que espera el motor).
function summaryOf(entries) {
  return [
    '# Session Log',
    '',
    '> **Contexto de proyecto (siempre cargado):** `PROJECT_STATE.md`.',
    '',
    '---',
    '',
    ENTRIES_START,
    '',
    ...entries,
    ENTRIES_END,
    '',
    `${FOOTER_MARK} progreso (via \`/record\` o \`summarizer\`), añade entradas al inicio, tras este bloque (formato 2.0 con topic + 6 campos):`,
    '',
    '```markdown',
    '## YYYY-MM-DD — <Título corto>',
    '',
    'topic: <family/kebab>',
    '```',
    '',
    '> Topic upsert: mismo `topic:` en 7d → actualiza no duplicar.',
    '',
    '---',
    '',
    '## Índice de historial archivado (CAPA 2)',
    '',
    '| Semana (lunes) | Archivo |',
    '|----------------|---------|',
    '| (aún sin historial) | — |',
    '',
  ].join('\n');
}

// Proyecto mínimo VÁLIDO en `dir`: SUMMARY.md (marcadores 1/1), PROJECT_STATE.md
// (§2 + §4) y CHANGELOG/ creado (destino de la rotación; memory-rotate hace
// mkdir él mismo al escribir, pero el fixture lo deja listo desde el inicio).
// Devuelve `dir` para encadenar: `makeProject(tmpdir('advisor-fixture'))`.
export function makeProject(dir) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'CHANGELOG'), { recursive: true });
  writeFileSync(join(dir, 'PROJECT_STATE.md'), PROJECT_STATE, 'utf8');
  writeFileSync(join(dir, 'SUMMARY.md'), summaryOf([]), 'utf8');
  return dir;
}

// Fechas de fixture: 2026-09-06 y un día hacia atrás por entrada. Todas caen en
// la semana ISO del lunes 2026-08-31 (la semana más antigua de este repo), así
// que `mondayOf(fecha) < mondayOf(hoy)` y el motor las deemina rotables. El
// fixture es determinista (no depende de la fecha en que corra el test).
function entryDate(i) {
  return new Date(Date.UTC(2026, 8, 6) - i * 86400000).toISOString().slice(0, 10);
}

// SUMMARY.md con `n` entradas listas para rotar: orden descendente (más nueva
// arriba), cada una con topic/review_after y los 6 campos. `n === 0` deja la
// región vacía. Devuelve la ruta del SUMMARY.md escrito.
export function summaryWithEntries(dir, n) {
  mkdirSync(dir, { recursive: true });
  const count = Math.max(0, Number(n) || 0);
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push(entry(entryDate(i), `Entrada fixture ${i + 1}`, `Cuerpo de la entrada ${i + 1}.`));
  }
  writeFileSync(join(dir, 'SUMMARY.md'), summaryOf(entries), 'utf8');
  return join(dir, 'SUMMARY.md');
}

export function readIfExists(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

// Conteo de líneas con la misma semántica que `wc -l` (completo, incluye
// cabecera y pie): cuenta los LF del archivo. Sin salto final, la última línea
// no cuenta — igual que `wc -l` (ver nota B7 en scripts/check-memory-limits.sh).
// OJO: no es `contentLines` de memory-stats.mjs, que cuenta líneas NO VACÍAS
// solo entre marcadores; son dos métricas distintas a propósito.
export function countLines(p) {
  const txt = readIfExists(p);
  if (txt === null) return 0;
  let n = 0;
  for (let i = 0; i < txt.length; i++) if (txt.charCodeAt(i) === 10) n++;
  return n;
}