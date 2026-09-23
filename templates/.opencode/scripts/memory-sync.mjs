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
import { allEntries, fingerprint, isFresh, writeIndex, slugId, INDEX_VERSION } from './memory-index.mjs';
import { mondayOf } from './memory-stats.mjs';
// Dedup/normalización compartidos con el motor: una sola fuente de verdad para
// identificar entradas (`fecha--título normalizado`, case-insensitive y
// separador-agnóstico `— - : | ,`), tanto en `seen` (intra-run) como en
// `hasEntry` (cross-run).
import { hasEntry, appendToChangelog, normalize, parseEntryHeading } from './memory-rotate.mjs';

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
  const entries=[];
  if (existsSync(SUMMARY)) {
    const text = readFileSync(SUMMARY,'utf8');
    // split by ## date blocks
    const blocks = text.split(/\n(?=##\s+\d{4}-\d{2}-\d{2}\s+[—\-])/g).filter(b=>b.trim().startsWith('##'));
    for (const b of blocks) {
      const hm = b.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*[—\-]\s*(.+)$/m);
      const date = hm?hm[1]:new Date().toISOString().slice(0,10);
      const monday = mondayOf(date);
      const file = join(CHUNKS_DIR, `${monday}.json`);
      let arr=[]; if (existsSync(file) && !force) try { arr=JSON.parse(readFileSync(file,'utf8')); } catch {}
      const id = slugId(date, hm?hm[2].trim():b.slice(0,60));
      if (!arr.find(x=>x.id===id)) { arr.push({ id, date, monday, body: b.trim(), exportedAt: new Date().toISOString() }); writeFileSync(file, JSON.stringify(arr,null,2),'utf8'); entries.push(id); }
    }
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

  // Agrupa por archivo destino (CHANGELOG/<monday>.md).
  const byDest = new Map(); // destRel → { monday, entries[] }
  for (const f of files) {
    let arr;
    try { arr = JSON.parse(readFileSync(join(CHUNKS_DIR, f), 'utf8')); }
    catch { console.error(`import: chunk ilegible, omitido: ${f}`); continue; }
    if (!Array.isArray(arr)) continue;
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
    let content = before;
    for (const e of group.entries) {
      const body = String(e.body ?? '');
      if (!body.trim()) continue;
      const parsed = parseEntryHeading(body);
      const idKey = parsed ? parsed.id : (e.id || normalize(body).slice(0, 80));
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      const entry = { date: parsed ? parsed.date : String(e.date || ''), title: parsed ? parsed.title : '' };
      // Dedup cross-run contra el CHANGELOG (mismo id canónico que intra-run).
      if (entry.title ? hasEntry(content, entry) : content.includes(body.trim())) continue;
      content = appendToChangelog(content, e.monday || group.monday, body.trim());
      imported++;
    }
    if (content !== before) {
      mkdirSync(join(ROOT, 'CHANGELOG'), { recursive: true });
      writeFileSync(changelog, content, 'utf8');
      written++;
    }
  }
  console.log(`Import: ${imported} bloques a CHANGELOG/ (${written} archivo(s) escrito(s))`);
}

function stateDecisions() {
  if (!existsSync(STATE)) return [];
  const c = readFileSync(STATE, 'utf8');
  const sec2 = (c.split('## 2.')[1] || '').split('## 3.')[0] || '';
  return sec2.split('\n').filter(l => l.trim().startsWith('-'));
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
