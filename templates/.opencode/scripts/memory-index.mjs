#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-index.mjs (md+grep, sin SQLite)
 * Búsqueda progresiva inspirada en Engram: search → timeline → get
 * v2: índice derivado `.advisor/memory-index.json` con fingerprint
 * path+mtime+size (contrato loader.mjs: entradas ordenadas, comparación
 * por mapa, version:1). Escritura y lectura solo `.advisor/`. Score solo
 * en salida search --json, nunca persistido. Sin índice o stale → fallback
 * md+grep sin error.
 * Uso:
 *   node memory-index.mjs search "query" [--json] [--refresh]
 *   node memory-index.mjs timeline <id-or-date>  (date YYYY-MM-DD o índice)
 *   node memory-index.mjs get <id-or-date>
 *   node memory-index.mjs list [--json]
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const SUMMARY = join(ROOT, 'SUMMARY.md');
const STATE = join(ROOT, 'PROJECT_STATE.md');
const CHANGELOG_DIR = join(ROOT, 'CHANGELOG');
const INDEX_VERSION = 1;
const INDEX_FILE = join(ROOT, '.advisor', 'memory-index.json');

function slugId(date, title) {
  return `${date}--${String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
}

function parseEntries(text, source) {
  const entries = [];
  let m; const lines = text.split('\n');
  // collect blocks by ## headings
  const blocks = []; let cur=null;
  for (let i=0;i<lines.length;i++) {
    const h = lines[i].match(/^##\s+(\d{4}-\d{2}-\d{2})\s*[—\-]\s*(.+)$/);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { date: h[1], title: h[2].trim(), start: i, source, lines: [lines[i]] };
    } else if (cur) cur.lines.push(lines[i]);
  }
  if (cur) blocks.push(cur);
  for (const b of blocks) {
    const body = b.lines.join('\n');
    const topic = (body.match(/topic:\s*([a-z0-9\/\-]+)/i)||[])[1]||null;
    const review_after = (body.match(/review_after:\s*(\d{4}-\d{2}-\d{2})/i)||[])[1]||null;
    entries.push({ id: slugId(b.date, b.title), date: b.date, title: b.title, topic, review_after, source: b.source, preview: b.lines.slice(1,5).join(' ').slice(0,160) });
  }
  return entries;
}

function allEntries() {
  const out=[];
  if (existsSync(SUMMARY)) out.push(...parseEntries(readFileSync(SUMMARY,'utf8'), 'SUMMARY.md'));
  if (existsSync(CHANGELOG_DIR)) {
    for (const f of readdirSync(CHANGELOG_DIR)) {
      if (!f.endsWith('.md')) continue;
      const p = join(CHANGELOG_DIR, f);
      try { out.push(...parseEntries(readFileSync(p,'utf8'), `CHANGELOG/${f}`)); } catch {}
    }
  }
  if (existsSync(STATE)) {
    // decisions §2 as entries-like
    const c = readFileSync(STATE,'utf8');
    const sec2 = (c.split('## 2.')[1]||'').split('## 3.')[0]||'';
    const lines = sec2.split('\n').filter(l=>l.trim().startsWith('-'));
    for (const l of lines) {
      const topic = (l.match(/topic:\s*([a-z0-9\/\-]+)/i)||[])[1]||null;
      out.push({ id: `state--${l.slice(2,40).replace(/[^a-z0-9]+/gi,'-')}`, date: 'state', title: l.slice(2,80).trim(), topic, source: 'PROJECT_STATE.md §2', preview: l.slice(0,160) });
    }
  }
  return out;
}

function sourceFiles() {
  const files = [];
  if (existsSync(STATE)) files.push('PROJECT_STATE.md');
  if (existsSync(SUMMARY)) files.push('SUMMARY.md');
  if (existsSync(CHANGELOG_DIR)) {
    for (const f of readdirSync(CHANGELOG_DIR)) {
      if (f.endsWith('.md')) files.push(`CHANGELOG/${f}`);
    }
  }
  return files.sort();
}

function fingerprint() {
  const fp = [];
  for (const rel of sourceFiles()) {
    try {
      const st = statSync(join(ROOT, rel));
      fp.push({ path: rel, mtime: st.mtimeMs, size: st.size });
    } catch {
      fp.push({ path: rel, mtime: 0, size: 0 });
    }
  }
  return fp.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function isFresh(cached, currentFp = fingerprint()) {
  if (!cached || cached.version !== INDEX_VERSION || !Array.isArray(cached.fingerprint)) return false;
  if (cached.fingerprint.length !== currentFp.length) return false;
  const map = new Map(cached.fingerprint.map(e => [e.path, e]));
  for (const c of currentFp) {
    const e = map.get(c.path);
    if (!e || e.mtime !== c.mtime || e.size !== c.size) return false;
  }
  return true;
}

function score(entry, query, now = Date.now()) {
  const q = (query || '').toLowerCase();
  const t = Date.parse(entry.date || '1970-01-01');
  const recency = Number.isFinite(t) ? 1 - Math.min(1, (now - t) / (30 * 864e5)) : 0;
  const topic = (entry.topic || '').toLowerCase().includes(q) ? 1 : 0;
  const title = (entry.title || '').toLowerCase().includes(q) ? 1 : ((entry.preview || '').toLowerCase().includes(q) ? 0.5 : 0);
  return 0.6 * recency + 0.3 * topic + 0.1 * title;
}

function loadIndex() {
  const f = INDEX_FILE;
  if (!existsSync(f)) return null;
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    if (data.version !== INDEX_VERSION || !Array.isArray(data.entries)) return null;
    return { data, fresh: isFresh(data), file: f };
  } catch { return null; }
}

function writeIndex() {
  mkdirSync(join(ROOT, '.advisor'), { recursive: true });
  const data = { version: INDEX_VERSION, generatedAt: new Date().toISOString(), fingerprint: fingerprint(), entries: allEntries() };
  writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

// NOTA: substring case-insensitive, no regex perl. `timeline`/`get`
// aceptan id exacto, fecha o subcadena de título por la misma razón.
function matches(e, q) {
  return (e.title + ' ' + e.preview + ' ' + (e.topic || '')).toLowerCase().includes(q);
}

function freshEntries() {
  const loaded = loadIndex();
  if (loaded && loaded.fresh) return loaded.data.entries;
  if (loaded) console.error('⚠️ memory-index.json desactualizado (stale) — fallback md+grep.');
  return allEntries();
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  const json = process.argv.includes('--json');

  switch(cmd){
    case 'search': {
      if (!arg) { console.error('Uso: memory-index.mjs search "query" [--json] [--refresh]'); process.exit(1); }
      if (process.argv.includes('--refresh')) writeIndex();
      const q = arg.toLowerCase();
      const loaded = loadIndex();
      let hits;
      if (loaded && loaded.fresh) {
        hits = loaded.data.entries
          .filter(e => matches(e, q))
          .map(e => ({ ...e, score: score(e, arg) }))
          .sort((a, b) => b.score - a.score);
      } else {
        if (loaded) console.error('⚠️ memory-index.json desactualizado (stale) — fallback md+grep.');
        hits = allEntries().filter(e => matches(e, q));
        if (json) hits = hits.map(e => ({ ...e, score: score(e, arg) }));
      }
      if (json) console.log(JSON.stringify(hits,null,2));
      else {
        if (!hits.length) console.log(`Sin resultados para "${arg}".`);
        else for (const h of hits) console.log(`- ${h.id} [${h.source}] topic:${h.topic||'-'} — ${h.title} :: ${h.preview.slice(0,80)}`);
      }
      break;
    }
    case 'timeline':
    case 'get': {
      if (!arg) { console.error(`Uso: memory-index.mjs ${cmd} <id-or-date>`); process.exit(1); }
      const entries = freshEntries();
      const hit = entries.find(e=>e.id===arg || e.date===arg || e.title.toLowerCase().includes(arg.toLowerCase()));
      if (!hit) { console.error(`No encontrado: ${arg}. Prueba: search "query"`); process.exit(1); }
      // for get, dump full file section
      let text='';
      const src = hit.source.includes('SUMMARY')?SUMMARY: hit.source.includes('CHANGELOG')?join(ROOT,hit.source):STATE;
      try { text=readFileSync(src,'utf8'); } catch {}
      if (cmd==='get') {
        if (hit.source.startsWith('PROJECT_STATE')) {
          const sec2 = (text.split('## 2.')[1]||'').split('## 3.')[0]||'';
          console.log(`# PROJECT_STATE.md §2 — ${hit.title}\n${sec2.trim().slice(0,2000)}`);
          break;
        }
        // extract block of this entry
        const re = new RegExp(`##\\s+${hit.date.replace(/-/g,'\\-')}[\\s\\S]*?(?=\\n##\\s+\\d{4}-\\d{2}-\\d{2}|$)`, 'm');
        const m = text.match(re);
        console.log(m?m[0].trim(): text.slice(0,2000));
      } else {
        console.log(`# ${hit.id} [${hit.source}] topic:${hit.topic||'-'}`);
        console.log(hit.preview);
        // show neighbors
        const idx = entries.indexOf(hit);
        console.log('\n-- vecinos --');
        for (const nb of entries.slice(Math.max(0,idx-2), idx+3)) if (nb!==hit) console.log(`  - ${nb.id} [${nb.source}] ${nb.title}`);
      }
      break;
    }
    case 'list': {
      const e = allEntries();
      if (json) console.log(JSON.stringify(e,null,2));
      else for (const x of e) console.log(`- ${x.id} [${x.source}] topic:${x.topic||'-'} — ${x.title}`);
      break;
    }
    default: {
      console.log(`Uso:
  node .opencode/scripts/memory-index.mjs search "query" [--json] [--refresh]
  node .opencode/scripts/memory-index.mjs timeline <id-or-date>
  node .opencode/scripts/memory-index.mjs get <id-or-date>
  node .opencode/scripts/memory-index.mjs list [--json]`);
      process.exit(1);
    }
  }
}

let isMain = false;
try { isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { isMain = false; }
if (isMain) main();

export { allEntries, fingerprint, isFresh, score, loadIndex, writeIndex, slugId, INDEX_VERSION };
