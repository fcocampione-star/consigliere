#!/usr/bin/env node
/**
 * ADVISOR 2.0 — Skill Loader runtime con cache fingerprint
 *
 * Carga skills bajo demanda (proyecto + autoskills) + chunks.
 * Cache: .advisor/skill-registry.cache.json con fingerprint path+mtime+size
 *        inspirado en Gentle AI skill-registry fingerprint.
 *        Legacy pre-rename .consigliere/ solo como fallback de LECTURA
 *        (nunca se escribe ahí; sin symlink por compat Windows).
 *
 * Uso:
 *   node loader.mjs list [--refresh|--force|--json]
 *   node loader.mjs search "query" [--json]
 *   node loader.mjs load "skill-name"
 *   node loader.mjs chunk "skill-name" urls,shortcuts,examples
 *   node loader.mjs refresh [--force]
 */
import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..', '..', '..');

const LOCATIONS = [
  join(PROJECT_ROOT, '.opencode', 'skills'),
  join(PROJECT_ROOT, '.agents', 'skills'),
];
const CACHE_DIR = join(PROJECT_ROOT, '.advisor');
const LEGACY_CACHE_DIR = join(PROJECT_ROOT, '.consigliere'); // fallback solo lectura
const CACHE_FILE = join(CACHE_DIR, 'skill-registry.cache.json');
const LEGACY_CACHE_FILE = join(LEGACY_CACHE_DIR, 'skill-registry.cache.json');
const CACHE_VERSION = 2;

function listSkillsRaw() {
  const found = new Map();
  for (const loc of LOCATIONS) {
    if (!existsSync(loc)) continue;
    for (const name of readdirSync(loc)) {
      if (name.startsWith('.')) continue;
      const dir = join(loc, name);
      const skill = join(dir, 'SKILL.md');
      if (!existsSync(skill)) continue;
      if (!found.has(name)) {
        found.set(name, { name, path: skill, source: loc.includes('.agents') ? 'autoskill' : 'proyecto' });
      }
    }
  }
  return [...found.values()];
}

function fingerprint(skills) {
  const fp = [];
  for (const s of skills) {
    try {
      const st = statSync(s.path);
      fp.push({ name: s.name, path: s.path, mtime: st.mtimeMs, size: st.size, source: s.source });
    } catch {
      fp.push({ name: s.name, path: s.path, mtime: 0, size: 0, source: s.source });
    }
  }
  return fp.sort((a, b) => a.name.localeCompare(b.name));
}

function loadCache() {
  // Precedencia: .advisor/ primero; legacy .consigliere/ solo lectura.
  for (const f of [CACHE_FILE, LEGACY_CACHE_FILE]) {
    if (!existsSync(f)) continue;
    try {
      const data = JSON.parse(readFileSync(f, 'utf8'));
      if (data.version !== CACHE_VERSION) continue;
      return data;
    } catch { continue; }
  }
  return null;
}

function saveCache(fp) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, generatedAt: new Date().toISOString(), entries: fp }, null, 2), 'utf8');
  } catch {}
}

function isCacheValid(cached, currentFp) {
  if (!cached || !cached.entries) return false;
  if (cached.entries.length !== currentFp.length) return false;
  const map = new Map(cached.entries.map(e => [e.name, e]));
  for (const c of currentFp) {
    const e = map.get(c.name);
    if (!e || e.path !== c.path || e.mtime !== c.mtime || e.size !== c.size) return false;
  }
  return true;
}

function listSkillsCached(force = false) {
  const raw = listSkillsRaw();
  const fp = fingerprint(raw);
  const cached = loadCache();
  if (!force && isCacheValid(cached, fp)) {
    return raw.map(r => {
      const e = cached.entries.find(x => x.name === r.name);
      return { ...r, description: e?.description || null, cached: true };
    });
  }
  // enrich with description for cache next time
  const enriched = fp.map(e => {
    try {
      const fm = readFrontmatter(readFileSync(e.path, 'utf8'));
      return { ...e, description: (fm.description || '').slice(0, 120) };
    } catch { return { ...e, description: '' }; }
  });
  saveCache(enriched);
  return raw.map(r => {
    const e = enriched.find(x => x.name === r.name);
    return { ...r, description: e?.description || null, cached: false };
  });
}

function readFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  const desc = m[1].match(/description:\s*(?:\n\s*\|)?\s*([\s\S]*?)\n\w+:/);
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  if (desc) fm.description = desc[1].trim();
  return fm;
}

function chunkNames(content) {
  const names = [];
  const re = /<!--\s*CHUNK:\s*([\w-]+)\s*-->/g;
  let m;
  while ((m = re.exec(content))) names.push(m[1]);
  return names;
}

function extractChunks(content, wanted) {
  const re = /<!--\s*CHUNK:\s*([\w-]+)\s*-->([\s\S]*?)<!--\s*\/CHUNK\s*-->/g;
  let m;
  const out = [];
  const set = new Set(wanted);
  while ((m = re.exec(content))) {
    if (set.has(m[1])) out.push(`<!-- CHUNK: ${m[1]} -->\n${m[2].trim()}`);
  }
  return out;
}

function findSkill(name, useCache = true) {
  const skills = useCache ? listSkillsCached(false) : listSkillsRaw();
  for (const s of skills) if (s.name === name) return s;
  return null;
}

const args = process.argv.slice(2);
const cmd = args[0];
const arg = args[1];
const arg2 = args[2];
const hasFlag = (f) => args.includes(f);

switch (cmd) {
  case 'list': {
    const force = hasFlag('--refresh') || hasFlag('--force');
    const json = hasFlag('--json');
    const skills = listSkillsCached(force);
    if (!skills.length) { console.log('No hay skills disponibles.'); break; }
    if (json) {
      console.log(JSON.stringify(skills.map(s => ({ name: s.name, source: s.source, path: s.path, description: s.description, cached: s.cached })), null, 2));
    } else {
      for (const s of skills) {
        const desc = s.description ?? (() => { try { return (readFrontmatter(readFileSync(s.path, 'utf8')).description || '').slice(0,80); } catch { return ''; } })();
        console.log(`- ${s.name} [${s.source}]${s.cached ? ' (cache)' : ''} — ${desc}`);
      }
    }
    break;
  }
  case 'refresh': {
    const skills = listSkillsCached(true);
    console.log(`Cache regenerada: ${skills.length} skills → ${CACHE_FILE}`);
    break;
  }
  case 'search': {
    const q = (arg || '').toLowerCase();
    const json = hasFlag('--json');
    const skills = listSkillsCached(false);
    const hits = [];
    for (const s of skills) {
      const content = readFileSync(s.path, 'utf8');
      const fm = readFrontmatter(content);
      const hay = (content + '\n' + (fm.description || '')).toLowerCase();
      if (q && hay.includes(q)) hits.push({ name: s.name, source: s.source, description: (fm.description || '').slice(0, 80) });
    }
    if (json) console.log(JSON.stringify(hits, null, 2));
    else console.log(hits.length ? hits.map(h => `- ${h.name} [${h.source}]: ${h.description}`).join('\n') : `Sin resultados para "${arg}".`);
    break;
  }
  case 'load': {
    const s = findSkill(arg, true);
    if (!s) { console.error(`Skill "${arg}" no encontrada. Usa "list" para ver disponibles.`); process.exit(1); }
    const content = readFileSync(s.path, 'utf8');
    const fm = readFrontmatter(content);
    console.log(`# ${s.name} [${s.source}]`);
    console.log(`Path: ${s.path}`);
    console.log(`Description: ${(fm.description || '').trim()}`);
    console.log(`Chunks: ${chunkNames(content).join(', ') || '(ninguno)'}`);
    break;
  }
  case 'chunk': {
    const s = findSkill(arg, true);
    if (!s) { console.error(`Skill "${arg}" no encontrada.`); process.exit(1); }
    const content = readFileSync(s.path, 'utf8');
    const wanted = (arg2 || 'all').split(',').map((x) => x.trim()).filter(Boolean);
    let parts;
    if (wanted.includes('all')) parts = extractChunks(content, chunkNames(content));
    else parts = extractChunks(content, wanted);
    if (!parts.length) { console.error(`Skill "${arg}" no tiene chunks ${wanted.join(',')} (${chunkNames(content).join(',')}).`); process.exit(1); }
    console.log(parts.join('\n\n'));
    break;
  }
  default:
    console.log(`Uso:
  node loader.mjs list [--refresh|--json]
  node loader.mjs refresh [--force]
  node loader.mjs search "query" [--json]
  node loader.mjs load "skill-name"
  node loader.mjs chunk "skill-name" urls,shortcuts,examples`);
    process.exit(1);
}
