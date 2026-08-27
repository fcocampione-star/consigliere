#!/usr/bin/env node
/**
 * CONSIGLIERE — Skill Loader runtime
 *
 * Carga skills de documentación bajo demanda (proyecto + autoskills) y permite
 * leer solo chunks concretos de una SKILL.md para ahorrar tokens.
 *
 * Uso:
 *   node loader.mjs list
 *   node loader.mjs search "query"
 *   node loader.mjs load "skill-name"
 *   node loader.mjs chunk "skill-name" urls,shortcuts,examples
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..', '..', '..'); // .opencode/skills/_skill-loader -> proyecto

const LOCATIONS = [
  join(PROJECT_ROOT, '.opencode', 'skills'),
  join(PROJECT_ROOT, '.agents', 'skills'),
];

function listSkills() {
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

function findSkill(name) {
  for (const s of listSkills()) {
    if (s.name === name) return s;
  }
  return null;
}

const [cmd, arg, arg2] = process.argv.slice(2);

switch (cmd) {
  case 'list': {
    const skills = listSkills();
    if (!skills.length) { console.log('No hay skills disponibles.'); break; }
    for (const s of skills) {
      const fm = readFrontmatter(readFileSync(s.path, 'utf8'));
      console.log(`- ${s.name} [${s.source}] — ${(fm.description || '').slice(0, 80)}`);
    }
    break;
  }

  case 'search': {
    const q = (arg || '').toLowerCase();
    const skills = listSkills();
    const hits = [];
    for (const s of skills) {
      const content = readFileSync(s.path, 'utf8');
      const fm = readFrontmatter(content);
      const hay = (content + '\n' + (fm.description || '')).toLowerCase();
      if (q && hay.includes(q)) hits.push(`- ${s.name} [${s.source}]: ${(fm.description || '').slice(0, 80)}`);
    }
    console.log(hits.length ? hits.join('\n') : `Sin resultados para "${arg}".`);
    break;
  }

  case 'load': {
    const s = findSkill(arg);
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
    const s = findSkill(arg);
    if (!s) { console.error(`Skill "${arg}" no encontrada.`); process.exit(1); }
    const content = readFileSync(s.path, 'utf8');
    const wanted = (arg2 || 'all').split(',').map((x) => x.trim()).filter(Boolean);
    let parts;
    if (wanted.includes('all')) {
      parts = extractChunks(content, chunkNames(content));
    } else {
      parts = extractChunks(content, wanted);
    }
    if (!parts.length) { console.error(`Skill "${arg}" no tiene chunks ${wanted.join(',')} (${chunkNames(content).join(',')}).`); process.exit(1); }
    console.log(parts.join('\n\n'));
    break;
  }

  default:
    console.log(`Uso:
  node loader.mjs list
  node loader.mjs search "query"
  node loader.mjs load "skill-name"
  node loader.mjs chunk "skill-name" urls,shortcuts,examples`);
    process.exit(1);
}
