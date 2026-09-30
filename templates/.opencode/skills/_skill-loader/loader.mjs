#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — Skill Loader runtime con cache fingerprint
 *
 * Carga skills bajo demanda (proyecto + autoskills) + chunks.
 * Cache: .advisor/skill-registry.cache.json con fingerprint path+mtime+size
 *        inspirado en Gentle AI skill-registry fingerprint.
 *
 * Uso:
 *   node loader.mjs list [--refresh|--force|--json]
 *   node loader.mjs search "query" [--json]
 *   node loader.mjs load "skill-name"
 *   node loader.mjs chunk "skill-name" urls,shortcuts,examples
 *   node loader.mjs refresh [--force]
 *
 * Salidas: 0 ok · 1 error (skill no encontrada, chunk inexistente o USO
 * INVÁLIDO: `chunk <skill>` sin nombres, `search` sin query, comando
 * desconocido o ninguno — en todos estos casos se imprime el uso real).
 *
 * Los comandos de LECTURA (`load`, `chunk`, `search`) son de solo lectura: NUNCA
 * escriben `.advisor/skill-registry.cache.json`. La cache solo se (re)genera en
 * `list` y `refresh`, que son los comandos cuyo objeto es el listado/cache.
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
const CACHE_FILE = join(CACHE_DIR, 'skill-registry.cache.json');
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
  const f = CACHE_FILE;
  if (!existsSync(f)) return null;
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    if (data.version !== CACHE_VERSION) return null;
    return data;
  } catch { return null; }
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

// `persist` decide si esta rutina puede ESCRIBIR la cache. Por defecto false:
// leer (load/chunk/search) no muta estado en disco; solo `list` y `refresh` —
// los comandos cuyo objeto es el listado/cache — pasan true. El formato de la
// cache no cambia, así que una cache existente se sigue aceptando.
function listSkillsCached(force = false, persist = false) {
  const raw = listSkillsRaw();
  const fp = fingerprint(raw);
  const cached = loadCache();
  if (!force && isCacheValid(cached, fp)) {
    // Una clave por nombre: el find() dentro del map era un O(n²).
    const byName = new Map(cached.entries.map(e => [e.name, e]));
    return raw.map(r => {
      const e = byName.get(r.name);
      return { ...r, description: e?.description || null, cached: true };
    });
  }
  // enrich with description for cache next time
  const enriched = fp.map(e => {
    try {
      const fm = readFrontmatter(readFileSync(e.path, 'utf8'));
      return { ...e, description: summaryLine(fm.description, 120) };
    } catch { return { ...e, description: '' }; }
  });
  if (persist) saveCache(enriched);
  const byName = new Map(enriched.map(e => [e.name, e]));
  return raw.map(r => {
    const e = byName.get(r.name);
    return { ...r, description: e?.description || null, cached: false };
  });
}

// Normaliza el texto ANTES de cualquier parseo markdown: quita el BOM inicial
// (UTF-8 con BOM) y convierte CRLF/CR a LF. Sin esto, el patrón de front-matter
// no casa en un checkout Windows (core.autocrlf=true) ni en un archivo con BOM y
// la función devuelve {} — descripciones vacías y validación de chunks saltada.
// NOTA: debe consolidarse con los helpers markdown compartidos cuando exista
// .opencode/scripts/lib/; de momento va en línea a propósito.
function normalizeText(content) {
  return String(content ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

// Descripción de LISTADO: siempre UNA línea. El front-matter admite bloques
// escalares (`description: |`), así que su valor trae saltos de línea; sin
// aplanarlos, `list` y `search` imprimían una entrada partida en varias líneas
// y se rompía el formato "una skill por línea" (y su parseo). El valor
// completo y multilínea sigue saliendo tal cual en `load`.
function summaryLine(desc, max) {
  // El trim final importa: el corte por longitud puede dejar un espacio o salto
  // colgando en el borde de la línea.
  return String(desc ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function readFrontmatter(content) {
  const m = normalizeText(content).match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return {};
  const fm = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === '|' || val === '>') {
      const buf = [];
      while (i + 1 < lines.length && /^[ \t]+/.test(lines[i + 1])) buf.push(lines[++i].replace(/^ {1,2}/, ''));
      val = val === '>' ? buf.join(' ').trim() : buf.join('\n').trim();
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    fm[key] = val;
    if (key === 'chunks') fm.chunksList = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return fm;
}

function validateSkill(name, content, fm) {
  const warnings = [];
  if (fm.name && fm.name !== name) warnings.push(`frontmatter name "${fm.name}" ≠ directorio "${name}"`);
  if (fm.chunksList) {
    const actual = chunkNames(content);
    for (const c of fm.chunksList) {
      if (!actual.includes(c)) warnings.push(`chunks: declara "${c}" sin marcador <!-- CHUNK: ${c} -->`);
    }
  }
  return warnings;
}

// Detección de bloques de código fence (CommonMark básico, como el parser
// fence-aware de memory-rotate): apertura = hasta 3 espacios de indentación +
// ``` o ~~~ de 3+ caracteres; cierre = mismo carácter, longitud >= a la de
// apertura y nada más en la línea. Emparejar fence a ciegas (el bug anterior)
// tomaba como bloque cualquier par de ``` — incluidos los de ejemplo anidados
// dentro de un fence de 4 — y hacía que un marcador de chunk que era solo
// documentación pareciera texto real.
function fenceSpans(content) {
  const text = normalizeText(content);
  const spans = [];
  const open = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  let fence = null; // { char, len, start }
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const m = open.exec(line);
    if (fence) {
      // Solo cierra el mismo carácter, con al menos tantos como la apertura y
      // sin info string detrás.
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === '') {
        spans.push([fence.start, lineStart + line.length]);
        fence = null;
      }
      continue;
    }
    // Un fence de info string con backticks dentro no es un fence (CommonMark).
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) fence = { char: m[1][0], len: m[1].length, start: lineStart };
  }
  if (fence) spans.push([fence.start, text.length]); // fence sin cerrar: llega al final
  return spans;
}

function inSpans(spans, idx) {
  for (const [a, b] of spans) if (idx >= a && idx < b) return true;
  return false;
}

function chunkNames(raw) {
  const content = normalizeText(raw);
  const spans = fenceSpans(content);
  const names = [];
  const re = /<!--\s*CHUNK:\s*([\w-]+)\s*-->/g;
  let m;
  while ((m = re.exec(content))) if (!inSpans(spans, m.index)) names.push(m[1]);
  return names;
}

function extractChunks(raw, wanted) {
  const content = normalizeText(raw);
  const spans = fenceSpans(content);
  const re = /<!--\s*(\/)?CHUNK(?::\s*([\w-]+))?\s*-->/g;
  let m;
  const out = [];
  const set = new Set(wanted);
  let open = null;
  while ((m = re.exec(content))) {
    if (inSpans(spans, m.index)) continue;
    if (!m[1]) open = { name: m[2], start: m.index + m[0].length };
    else if (open) {
      if (set.has(open.name)) out.push(`<!-- CHUNK: ${open.name} -->\n${content.slice(open.start, m.index).trim()}`);
      open = null;
    }
  }
  return out;
}

function findSkill(name, useCache = true) {
  // useCache=true lee la cache en memoria pero NO la escribe: buscar una skill
  // es una operación de lectura.
  const skills = useCache ? listSkillsCached(false, false) : listSkillsRaw();
  for (const s of skills) if (s.name === name) return s;
  return null;
}

const args = process.argv.slice(2);
const cmd = args[0];
const arg = args[1];
const arg2 = args[2];
const hasFlag = (f) => args.includes(f);

const USAGE = `Uso:
  node loader.mjs list [--refresh|--json]
  node loader.mjs refresh [--force]
  node loader.mjs search "query" [--json]
  node loader.mjs load "skill-name"
  node loader.mjs chunk "skill-name" urls,shortcuts,examples`;

// Error de uso: explica qué falta y reimprime el uso real (exit 1, el mismo
// código documentado que el comando desconocido). Se distingue de "sin
// resultados": aquí falta un ARGUMENTO obligatorio.
function usageError(motivo) {
  console.error(`loader.mjs: ${motivo}\n`);
  console.error(USAGE);
  process.exit(1);
}

switch (cmd) {
  case 'list': {
    const force = hasFlag('--refresh') || hasFlag('--force');
    const json = hasFlag('--json');
    const skills = listSkillsCached(force, true);
    if (!skills.length) { console.log('No hay skills disponibles.'); break; }
    if (json) {
      console.log(JSON.stringify(skills.map(s => ({ name: s.name, source: s.source, path: s.path, description: s.description, cached: s.cached })), null, 2));
    } else {
      for (const s of skills) {
        const desc = s.description ?? (() => { try { return summaryLine(readFrontmatter(readFileSync(s.path, 'utf8')).description, 80); } catch { return ''; } })();
        console.log(`- ${s.name} [${s.source}]${s.cached ? ' (cache)' : ''} — ${desc}`);
      }
    }
    break;
  }
  case 'refresh': {
    const skills = listSkillsCached(true, true);
    console.log(`Cache regenerada: ${skills.length} skills → ${CACHE_FILE}`);
    break;
  }
  case 'search': {
    // `search` sin query es un error de uso, no "cero resultados": antes caía
    // en el mensaje `Sin resultados para "undefined"`. Un primer token con
    // guion se interpreta como flag, así que `search --json` también es uso.
    if (!arg || !String(arg).trim() || String(arg).startsWith('-')) usageError('falta la query de búsqueda.');
    const q = String(arg).toLowerCase();
    const json = hasFlag('--json');
    const skills = listSkillsCached(false, false);
    const hits = [];
    for (const s of skills) {
      const content = readFileSync(s.path, 'utf8');
      const fm = readFrontmatter(content);
      const hay = (content + '\n' + (fm.description || '')).toLowerCase();
      if (hay.includes(q)) hits.push({ name: s.name, source: s.source, description: summaryLine(fm.description, 80) });
    }
    if (json) console.log(JSON.stringify(hits, null, 2));
    else console.log(hits.length ? hits.map(h => `- ${h.name} [${h.source}]: ${h.description}`).join('\n') : `Sin resultados para "${arg}".`);
    break;
  }
  case 'load': {
    if (!arg || !String(arg).trim()) usageError('falta el nombre de la skill.');
    const s = findSkill(arg, true);
    if (!s) { console.error(`Skill "${arg}" no encontrada. Usa "list" para ver disponibles.`); process.exit(1); }
    const content = readFileSync(s.path, 'utf8');
    const fm = readFrontmatter(content);
    console.log(`# ${s.name} [${s.source}]`);
    console.log(`Path: ${s.path}`);
    console.log(`Description: ${(fm.description || '').trim()}`);
    console.log(`Chunks: ${chunkNames(content).join(', ') || '(ninguno)'}`);
    for (const w of validateSkill(s.name, content, fm)) console.error(`Aviso: ${w}`);
    break;
  }
  case 'chunk': {
    if (!arg || !String(arg).trim()) usageError('falta el nombre de la skill.');
    // Sin nombres de chunk NO se devuelve la skill entera en silencio: era el
    // fallo silencioso que hacía que un typo trajera el archivo completo.
    if (!arg2 || !String(arg2).trim()) usageError(`faltan los chunks a extraer de "${arg}".`);
    const s = findSkill(arg, true);
    if (!s) { console.error(`Skill "${arg}" no encontrada.`); process.exit(1); }
    const content = readFileSync(s.path, 'utf8');
    const wanted = String(arg2).split(',').map((x) => x.trim()).filter(Boolean);
    for (const w of validateSkill(s.name, content, readFrontmatter(content))) console.error(`Aviso: ${w}`);
    let parts;
    if (wanted.includes('all')) parts = extractChunks(content, chunkNames(content));
    else parts = extractChunks(content, wanted);
    if (!parts.length) { console.error(`Skill "${arg}" no tiene chunks ${wanted.join(',')} (${chunkNames(content).join(',')}).`); process.exit(1); }
    console.log(parts.join('\n\n'));
    break;
  }
  default:
    console.log(USAGE);
    process.exit(1);
}
