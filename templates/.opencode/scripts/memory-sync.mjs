#!/usr/bin/env node
/**
 * ADVISOR 2.0 — memory-sync.mjs (sync local, sin cloud)
 * Estado vivo en .advisor/chunks/; legacy .consigliere/chunks/ solo
 * fallback de LECTURA en import/status (nunca se escribe ahí).
 * Uso:
 *   node memory-sync.mjs export [--all]  # exporta SUMMARY/STATE a chunks JSON
 *   node memory-sync.mjs import          # importa chunks a CHANGELOG si faltan
 *   node memory-sync.mjs status
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CHUNKS_DIR = join(ROOT, '.advisor', 'chunks'); // escritura siempre aquí
const LEGACY_CHUNKS_DIR = join(ROOT, '.consigliere', 'chunks'); // lectura fallback
const SUMMARY = join(ROOT, 'SUMMARY.md');
const STATE = join(ROOT, 'PROJECT_STATE.md');

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
}

const cmd = process.argv[2];
if (cmd==='export') exportChunks(process.argv.includes('--all'));
else if (cmd==='import') importChunks();
else if (cmd==='status' || !cmd) status();
else { console.log('Uso: node memory-sync.mjs export [--all] | import | status'); process.exit(1); }
