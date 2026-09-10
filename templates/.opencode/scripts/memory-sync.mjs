#!/usr/bin/env node
/**
 * ADVISOR 2.0 — memory-sync.mjs (sync local, sin cloud)
 * Estado vivo en .advisor/; legacy .consigliere/ solo fallback de
 * LECTURA en import/status/loadIndex (nunca se escribe ahí).
 * Derivados: memory-manifest.json (<15 líneas, trackeable, SIN mtime
 * para evitar stale-on-clone) + memory-index.json (fingerprint completo,
 * git-ignored, regenerable). Fingerprint y parsers se reutilizan desde
 * memory-index.mjs (única fuente de verdad).
 * Uso:
 *   node memory-sync.mjs export [--all]  # chunks + manifest + index
 *   node memory-sync.mjs import          # importa chunks a CHANGELOG si faltan
 *   node memory-sync.mjs status
 *   node memory-sync.mjs buildManifest   # solo manifest
 *   node memory-sync.mjs buildIndex      # solo índice
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allEntries, fingerprint, isFresh, writeIndex, INDEX_VERSION } from './memory-index.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const ADVISOR_DIR = join(ROOT, '.advisor'); // escritura siempre aquí
const CHUNKS_DIR = join(ADVISOR_DIR, 'chunks');
const LEGACY_CHUNKS_DIR = join(ROOT, '.consigliere', 'chunks'); // lectura fallback
const LEGACY_INDEX_FILE = join(ROOT, '.consigliere', 'memory-index.json'); // lectura fallback
const SUMMARY = join(ROOT, 'SUMMARY.md');
const STATE = join(ROOT, 'PROJECT_STATE.md');
const CHANGELOG_DIR = join(ROOT, 'CHANGELOG');
const MANIFEST_FILE = join(ADVISOR_DIR, 'memory-manifest.json');
const INDEX_FILE = join(ADVISOR_DIR, 'memory-index.json');
const MANIFEST_VERSION = 1;

function mondayOf(dateStr) {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0,10);
}

function exportChunks(all=false) {
  mkdirSync(CHUNKS_DIR, { recursive: true });
  const entries=[];
  if (existsSync(SUMMARY)) {
    const text = readFileSync(SUMMARY,'utf8');
    // split by ## date blocks
    const blocks = text.split(/\n(?=##\s+\d{4}-\d{2}-\d{2}\s+[—\-])/g).filter(b=>b.trim().startsWith('##'));
    for (const b of blocks) {
      const date = (b.match(/##\s+(\d{4}-\d{2}-\d{2})/)||[])[1]||new Date().toISOString().slice(0,10);
      const monday = mondayOf(date);
      const file = join(CHUNKS_DIR, `${monday}.json`);
      let arr=[]; if (existsSync(file) && !all) try { arr=JSON.parse(readFileSync(file,'utf8')); } catch {}
      const id = `${date}--${b.slice(0,60).replace(/\W+/g,'-')}`;
      if (!arr.find(x=>x.id===id)) { arr.push({ id, date, monday, body: b.trim(), exportedAt: new Date().toISOString() }); writeFileSync(file, JSON.stringify(arr,null,2),'utf8'); entries.push(id); }
    }
  }
  if (existsSync(STATE)) {
    const file = join(CHUNKS_DIR, `state.json`);
    const body = readFileSync(STATE,'utf8');
    writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), body }, null, 2), 'utf8');
  }
  console.log(`Export: ${entries.length} bloques nuevos → ${CHUNKS_DIR}${all?' (all)':''}`);
}

function importChunks() {
  // Lee vivo + legacy (sin duplicar); escribe solo CHANGELOG/.
  const dirs = [CHUNKS_DIR, LEGACY_CHUNKS_DIR].filter((d, i, a) => existsSync(d) && a.indexOf(d) === i);
  if (!dirs.length) { console.log('Sin chunks en .advisor/chunks/'); return; }
  let imported=0;
  for (const dir of dirs) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f==='state.json') continue;
    const p = join(dir,f);
    const arr = JSON.parse(readFileSync(p,'utf8'));
    const changelog = join(ROOT,'CHANGELOG', f.replace('.json','.md'));
    let existing=''; if (existsSync(changelog)) existing=readFileSync(changelog,'utf8');
    for (const e of arr) {
      if (!existing.includes(e.body.slice(0,80))) {
        const header = existsSync(changelog)?'':`# Changelog ${e.monday}\n\n> Historial semanal archivado desde SUMMARY.md. Detalle: \`git log\`.\n\n`;
        const toAppend = (existsSync(changelog)?'':header) + e.body + '\n\n';
        // append if not exists
        const cur = existsSync(changelog)?readFileSync(changelog,'utf8'):'';
        if (!cur.includes(e.body.slice(0,60))) {
          mkdirSync(join(ROOT,'CHANGELOG'),{recursive:true});
          const out = cur + (cur && !cur.endsWith('\n')?'\n':'') + toAppend;
          writeFileSync(changelog, out, 'utf8'); imported++;
        }
      }
    }
  }
  } // for dir
  console.log(`Import: ${imported} bloques a CHANGELOG/`);
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
  const files = [INDEX_FILE, LEGACY_INDEX_FILE].filter(f => existsSync(f));
  if (!files.length) { console.log('Index: falta (buildIndex lo genera)'); return; }
  const cur = fingerprint();
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(f, 'utf8'));
      const label = f === INDEX_FILE ? 'vivo' : 'legacy';
      console.log(`Index (${label}): ${data.version === INDEX_VERSION && isFresh(data, cur) ? 'fresh' : 'stale'} (${data.entries?.length ?? '?'} entries)`);
    } catch { console.log(`Index: corrupto en ${f}`); }
  }
}

function status() {
  for (const [label, dir] of [['vivo', CHUNKS_DIR], ['legacy', LEGACY_CHUNKS_DIR]]) {
    const files = existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.json')):[];
    console.log(`Chunks (${label}): ${files.length} en ${dir}`);
    for (const f of files) {
      const st = statSync(join(dir,f));
      const arr = (()=>{try{return JSON.parse(readFileSync(join(dir,f),'utf8'))}catch{return null}})();
      const count = Array.isArray(arr)?arr.length:(arr?'1 (state)':'?');
      console.log(`  - ${f}  ${count} entries  ${new Date(st.mtimeMs).toISOString()}`);
    }
  }
  console.log(`SUMMARY: ${existsSync(SUMMARY)?'ok':'falta'}  STATE: ${existsSync(STATE)?'ok':'falta'}`);
  manifestStatus();
  indexStatus();
}

const cmd = process.argv[2];
if (cmd==='export') { exportChunks(process.argv.includes('--all')); buildManifest(); buildIndex(); }
else if (cmd==='import') importChunks();
else if (cmd==='buildManifest') buildManifest();
else if (cmd==='buildIndex') buildIndex();
else if (cmd==='status' || !cmd) status();
else { console.log('Uso: node memory-sync.mjs export [--all] | import | status | buildManifest | buildIndex'); process.exit(1); }
