#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-sync.mjs (sync local, sin cloud)
 * Estado vivo en .advisor/ (escritura y lectura).
 * Derivados: memory-manifest.json (<15 líneas, trackeable, SIN mtime
 * para evitar stale-on-clone) + memory-index.json (fingerprint completo,
 * git-ignored, regenerable). Fingerprint y parsers se reutilizan desde
 * memory-index.mjs (única fuente de verdad).
 * Uso:
 *   node memory-sync.mjs export [--force]  # chunks + manifest + index (--all = alias)
 *   node memory-sync.mjs import          # importa chunks a CHANGELOG (idempotente)
 *   node memory-sync.mjs status
 *   node memory-sync.mjs buildManifest   # solo manifest
 *   node memory-sync.mjs buildIndex      # solo índice
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allEntries, fingerprint, isFresh, writeIndex, slugId, INDEX_VERSION, invalidateEntriesCache } from './memory-index.mjs';
import { mondayOf, entriesRegion, sectionText } from './memory-stats.mjs';
// Dedup/normalización compartidos con el motor: una sola fuente de verdad para
// identificar entradas (`fecha--título normalizado`, case-insensitive y
// separador-agnóstico `— - : | ,`), tanto en `seen` (intra-run) como en el
// índice de ids del destino (`entryIds`, cross-run O(1) por entrada).
import { appendToChangelog, normalize, parseEntryHeading, parseRegion, headingToId, entryIds } from './memory-rotate.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const ADVISOR_DIR = join(ROOT, '.advisor'); // escritura siempre aquí
const CHUNKS_DIR = join(ADVISOR_DIR, 'chunks');
const SUMMARY = join(ROOT, 'SUMMARY.md');
const STATE = join(ROOT, 'PROJECT_STATE.md');
const CHANGELOG_DIR = join(ROOT, 'CHANGELOG');
const MANIFEST_FILE = join(ADVISOR_DIR, 'memory-manifest.json');
const INDEX_FILE = join(ADVISOR_DIR, 'memory-index.json');
const MANIFEST_VERSION = 1;

// `mondayOf` (lunes ISO en UTC) se reutiliza desde memory-stats.mjs — única
// fuente de verdad. NOTA: el hook post-commit usa hora LOCAL (calibración %u);
// cerca del cambio de semana ambos pueden nombrar distinto archivo semanal —
// export/import leen todos los chunks existentes, así que no se pierde contenido.

function exportChunks(force=false) {
  mkdirSync(CHUNKS_DIR, { recursive: true });
  // FIX-2: invalida el memo de allEntries (memory-index) para que el proceso
  // anfitrión no sirva entradas stale tras una escritura de esta ruta.
  invalidateEntriesCache();
  const entries=[];
  if (existsSync(SUMMARY)) {
    const text = readFileSync(SUMMARY,'utf8');
    // Parseo por REGIÓN (marcadores) + parser tolerante del motor: una sola
    // fuente de verdad, alineada con el índice y con import. Complejidad O(n).
    const { region } = entriesRegion(text);
    const { entries: blocks } = parseRegion(region, { tolerant: true });
    // Agrupa en memoria por archivo semanal y escribe UNA vez por semana
    // (antes: re-leer+re-escribir el JSON de la semana por cada bloque → O(n²)).
    const byFile = new Map(); // file → { arr, ids }
    for (const b of blocks) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0,10);
      const monday = mondayOf(date);
      const file = join(CHUNKS_DIR, `${monday}.json`);
      if (!byFile.has(file)) {
        let arr=[];
        if (existsSync(file) && !force) { try { const p=JSON.parse(readFileSync(file,'utf8')); if (Array.isArray(p)) arr=p; } catch {} }
        byFile.set(file, { arr, ids: new Set(arr.map(x=>x.id)) });
      }
      const g = byFile.get(file);
      // Id canónico unificado con import/índice (`fecha--título normalizado`).
      const id = headingToId(b.text.split('\n',1)[0]) || slugId(date, b.title);
      if (!g.ids.has(id)) {
        g.ids.add(id);
        g.arr.push({ id, date, monday, body: b.text, exportedAt: new Date().toISOString() });
        entries.push(id);
      }
    }
    for (const [file, g] of byFile) writeFileSync(file, JSON.stringify(g.arr,null,2),'utf8');
  }
  if (existsSync(STATE)) {
    const file = join(CHUNKS_DIR, `state.json`);
    const body = readFileSync(STATE,'utf8');
    writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), body }, null, 2), 'utf8');
  }
  console.log(`Export: ${entries.length} bloques ${force?'forzados':'nuevos'} → ${CHUNKS_DIR}${force?' (--force)':''}`);
}

function importChunks() {
  // Lee vivo; escribe solo CHANGELOG/. IDEMPOTENTE: dedup por identificador
  // robusto `fecha + título normalizado` (mismo criterio que memory-rotate.mjs,
  // vía hasEntry/normalize) y UNA sola escritura por archivo destino (evita el
  // O(n²) de reescribir el CHANGELOG por cada entrada y el no-op si no cambia).
  if (!existsSync(CHUNKS_DIR)) { console.log('Sin chunks en .advisor/chunks/'); return; }
  const files = readdirSync(CHUNKS_DIR).filter((f) => f.endsWith('.json') && f !== 'state.json');
  if (!files.length) { console.log('Sin chunks en .advisor/chunks/'); return; }

  // Agrupa por archivo destino (CHANGELOG/<monday>.md). JSON.parse con
  // try/catch POR ARCHIVO: un chunk corrupto se omite y se resume, sin abortar
  // el resto del import (exit 0).
  const byDest = new Map(); // destRel → { monday, entries[] }
  const failed = [];
  for (const f of files) {
    let arr;
    try { arr = JSON.parse(readFileSync(join(CHUNKS_DIR, f), 'utf8')); }
    catch (e) { failed.push(f); console.error(`import: chunk corrupto, omitido: ${f} (${e.message})`); continue; }
    if (!Array.isArray(arr)) { failed.push(f); console.error(`import: chunk sin formato de lista, omitido: ${f}`); continue; }
    const monday = f.replace(/\.json$/, '');
    const destRel = join('CHANGELOG', `${monday}.md`);
    if (!byDest.has(destRel)) byDest.set(destRel, { monday, entries: [] });
    byDest.get(destRel).entries.push(...arr);
  }

  let imported = 0;
  let written = 0;
  const seen = new Set(); // dedup intra-ejecución por id canónico `fecha--título normalizado`
  for (const [destRel, group] of byDest) {
    const changelog = join(ROOT, destRel);
    const before = existsSync(changelog) ? readFileSync(changelog, 'utf8') : '';
    // Dedup cross-run O(1): indexa UNA vez los ids canónicos ya presentes en el
    // destino (entryIds) en vez de escanear el contenido por cada entrada (O(n²)).
    const existingIds = entryIds(before);
    // FIX-1 (O(n²) residual): ACUMULA las entradas del grupo y hace UNA sola
    // concatenación/`appendToChangelog` + UNA sola escritura al final, en vez de
    // reserializar el contenido creciente por cada entrada (≈n^1.9).
    const toAppend = [];
    for (const e of group.entries) {
      const body = String(e.body ?? '');
      if (!body.trim()) continue;
      const parsed = parseEntryHeading(body);
      const idKey = parsed ? parsed.id : (e.id || normalize(body).slice(0, 80));
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      if (parsed && parsed.title ? existingIds.has(idKey) : before.includes(body.trim())) continue;
      existingIds.add(idKey);
      toAppend.push(body.trim());
      imported++;
    }
    if (toAppend.length) {
      const content = appendToChangelog(before, group.monday, toAppend.join('\n\n'));
      mkdirSync(join(ROOT, 'CHANGELOG'), { recursive: true });
      writeFileSync(changelog, content, 'utf8');
      written++;
    }
  }
  // FIX-2: el CHANGELOG acaba de cambiar; invalida el memo para que las rutas
  // de lectura del proceso anfitrión (allEntries) vean las entradas nuevas.
  invalidateEntriesCache();
  const failNote = failed.length ? ` · ${failed.length} chunk(s) omitido(s) por JSON corrupto` : '';
  console.log(`Import: ${imported} bloques a CHANGELOG/ (${written} archivo(s) escrito(s))${failNote}`);
}

function stateDecisions() {
  if (!existsSync(STATE)) return [];
  const c = readFileSync(STATE, 'utf8');
  // §2 extraída con criterio tolerante (sectionText), sin numeración literal rígida.
  // FIX-3: `- ` (guion + espacio) evita contar la regla horizontal `---` como decisión.
  return sectionText(c, 2).split('\n').filter(l => l.trim().startsWith('- '));
}

function buildManifest() {
  mkdirSync(ADVISOR_DIR, { recursive: true });
  const entries = allEntries();
  const summaryEntries = entries
    .filter(e => e.source === 'SUMMARY.md')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 5);
  const decisions = stateDecisions();
  const today = new Date().toISOString().slice(0, 10);
  const stale = [];
  for (const l of decisions) {
    const ra = (l.match(/review_after:\s*(\d{4}-\d{2}-\d{2})/i) || [])[1];
    const topic = (l.match(/topic:\s*([a-z0-9\/\-]+)/i) || [])[1];
    if (ra && ra < today && topic && !stale.includes(topic)) stale.push(topic);
  }
  const archivedWeeks = existsSync(CHANGELOG_DIR) ? readdirSync(CHANGELOG_DIR).filter(f => f.endsWith('.md')).length : 0;
  // Serialización compacta: 8 líneas fijas + 1 por entrada reciente (≤5) → ≤13 líneas.
  const lines = [];
  lines.push('{');
  lines.push(`  "version": ${MANIFEST_VERSION},`);
  lines.push(`  "generatedAt": "${new Date().toISOString()}",`);
  lines.push(`  "counts": {"stateDecisions": ${decisions.length}, "recentEntries": ${entries.filter(e => e.source === 'SUMMARY.md').length}, "archivedWeeks": ${archivedWeeks}},`);
  lines.push('  "recent": [');
  summaryEntries.forEach((e, i) => lines.push(`    {"id": ${JSON.stringify(e.id)}, "topic": ${JSON.stringify(e.topic)}, "date": ${JSON.stringify(e.date)}}${i < summaryEntries.length - 1 ? ',' : ''}`));
  lines.push('  ],');
  lines.push(`  "stale": [${stale.map(t => JSON.stringify(t)).join(', ')}]`);
  lines.push('}');
  writeFileSync(MANIFEST_FILE, lines.join('\n') + '\n', 'utf8');
  console.log(`Manifest: ${lines.length} líneas → ${MANIFEST_FILE}`);
}

function buildIndex() {
  const data = writeIndex();
  console.log(`Index: v${data.version} ${data.entries.length} entries → ${INDEX_FILE}`);
}

function manifestStatus() {
  if (!existsSync(MANIFEST_FILE)) { console.log('Manifest: falta (buildManifest lo genera)'); return; }
  try {
    const m = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
    const n = readFileSync(MANIFEST_FILE, 'utf8').split('\n').length;
    const ok = m.version === MANIFEST_VERSION && Array.isArray(m.recent) && m.recent.length <= 5 && n < 15;
    console.log(`Manifest: ${ok ? 'ok' : 'revisar'} (${m.recent?.length ?? '?'} recientes, ${n} líneas, ${m.generatedAt ?? '?'})`);
  } catch { console.log('Manifest: corrupto (buildManifest lo regenera)'); }
}

function indexStatus() {
  const f = INDEX_FILE;
  if (!existsSync(f)) { console.log('Index: falta (buildIndex lo genera)'); return; }
  const cur = fingerprint();
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    console.log(`Index (vivo): ${data.version === INDEX_VERSION && isFresh(data, cur) ? 'fresh' : 'stale'} (${data.entries?.length ?? '?'} entries)`);
  } catch { console.log(`Index: corrupto en ${f}`); }
}

function status() {
  const dir = CHUNKS_DIR;
  const files = existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.json')):[];
  console.log(`Chunks (vivo): ${files.length} en ${dir}`);
  for (const f of files) {
    const st = statSync(join(dir,f));
    const arr = (()=>{try{return JSON.parse(readFileSync(join(dir,f),'utf8'))}catch{return null}})();
    const count = Array.isArray(arr)?arr.length:(arr?'1 (state)':'?');
    console.log(`  - ${f}  ${count} entries  ${new Date(st.mtimeMs).toISOString()}`);
  }
  console.log(`SUMMARY: ${existsSync(SUMMARY)?'ok':'falta'}  STATE: ${existsSync(STATE)?'ok':'falta'}`);
  manifestStatus();
  indexStatus();
}

function main() {
  const cmd = process.argv[2];
  const force = process.argv.includes('--force') || process.argv.includes('--all'); // --all = alias legacy de --force
  if (cmd==='export') { exportChunks(force); buildManifest(); buildIndex(); }
  else if (cmd==='import') importChunks();
  else if (cmd==='buildManifest') buildManifest();
  else if (cmd==='buildIndex') buildIndex();
  else if (cmd==='status' || !cmd) status();
  else { console.log('Uso: node memory-sync.mjs export [--force|--all] | import | status | buildManifest | buildIndex'); process.exit(1); }
}

let isMain = false;
try { isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { isMain = false; }
if (isMain) main();

export { mondayOf, exportChunks, importChunks, buildManifest, buildIndex };
