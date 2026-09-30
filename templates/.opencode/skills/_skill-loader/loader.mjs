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
 * `list` y `refresh`, que son los comandos cuyo objeto es el listado/cache, y se
 * escribe con `writeAtomic` de lib/core.mjs (temp+rename). Si esa escritura
 * falla, el aviso va a stderr y el comando sigue: la cache es un derivado.
 *
 * v5 (adopción de la lib compartida del harness): la lectura normalizada es
 * `readText` de `.opencode/scripts/lib/core.mjs`, las escrituras (la cache)
 * pasan por su `writeAtomic`, los fences se detectan con `fenceSpans` de
 * `lib/md.mjs` (una sola máquina de estados CommonMark en vez de dos) y el par
 * fingerprint/isFresh es el de `lib/cache.mjs`. Se mantiene el PROJECT_ROOT local
 * de tres niveles —core.REPO_ROOT resolvería en `.opencode/`— y el uso sin
 * comando por stdout.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitUsage, readText, writeAtomic } from '../../scripts/lib/core.mjs';
import { fenceSpans } from '../../scripts/lib/md.mjs';
import { fingerprint as fingerprintShared, isFresh } from '../../scripts/lib/cache.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Raíz del proyecto = TRES niveles por encima (skills/_skill-loader/ → skills/ →
// .opencode/ → raíz). core.REPO_ROOT no sirve: resuelve dos niveles desde lib/ y
// cae en `.opencode/`, un nivel más abajo que la raíz del proyecto.
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

// Fingerprint de la cache: path+mtime+size, la MISMA idea y la MISMA
// implementación que la familia memory-index (lib/cache.mjs). Orden estable por
// nombre (byte a byte, no por `localeCompare`, que depende del locale de la
// máquina) y `key` = nombre de la skill, que es por lo que se empareja la cache.
// La ruta que se le pasa es ABSOLUTA: `fingerprint` hace stat de `path` y una
// ruta relativa daría mtime/size 0 en todas las entradas, o sea un fingerprint
// que SIEMPRE parece fresco.
function fingerprint(skills) {
  return fingerprintShared(skills, (s) => s.name);
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

// Escritura de la cache: la ATÓMICA de lib/core.mjs (temp de nombre único en el
// mismo directorio + rename), la misma que usan memory-rotate/memory-sync. Antes
// escribía directo con writeFileSync y además se tragaba el error, con lo que un
// destino a medias o ilegible pasaba por una cache "escrita": era la última
// escritura no atómica del harness y contradecía el contrato de memory-sync
// ("todo fichero escrito pasa por temp+rename"). El error ya no se traga: se
// avisa por stderr con la ruta y el motivo, y el comando sigue — la cache es un
// derivado, no un requisito para leer skills, y un fallo al escribirla no puede
// convertir un `list` correcto en un error.
function saveCache(fp) {
  const payload = JSON.stringify({ version: CACHE_VERSION, generatedAt: new Date().toISOString(), entries: fp }, null, 2);
  try {
    writeAtomic(CACHE_FILE, payload);
    return true;
  } catch (e) {
    console.error(`loader: no se pudo escribir la cache ${CACHE_FILE} (${e.message}); el listado sigue y se regenerará en la próxima.`);
    return false;
  }
}

// `persist` decide si esta rutina puede ESCRIBIR la cache. Por defecto false:
// leer (load/chunk/search) no muta estado en disco; solo `list` y `refresh` —
// los comandos cuyo objeto es el listado/cache — pasan true. El formato de la
// cache no cambia, así que una cache existente se sigue aceptando.
function listSkillsCached(force = false, persist = false) {
  const raw = listSkillsRaw();
  const fp = fingerprint(raw);
  const cached = loadCache();
  if (!force && isFresh(cached?.entries, fp, (s) => s.name)) {
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
      const fm = readFrontmatter(readText(e.path));
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

// Normalización ANTES de cualquier parseo markdown: la hace `readText` de
// lib/core.mjs al LEER el archivo (quita el BOM inicial y convierte CRLF/CR a LF).
// Sin eso el patrón de front-matter no casa en un checkout Windows
// (core.autocrlf=true) ni en un archivo con BOM y `readFrontmatter` devolvería {}
// — descripciones vacías y validación de chunks saltada. Todas las lecturas de
// SKILL.md de este módulo pasan por ahí, así que el texto ya llega normalizado y
// los offsets de `fenceSpans` son coherentes con los slices.

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
  const m = String(content ?? '').match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
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

// Detección de bloques de código fence: la aporta `fenceSpans` de lib/md.mjs
// (CommonMark: hasta 3 de indentación, ``` o ~~~ de 3+, cierre con el MISMO carácter
// y longitud >= a la apertura, sin info string con backticks en un fence de
// backticks, y un fence sin cerrar hasta el final del texto). Es la misma máquina
// de estados fence-aware de memory-rotate: emparejar fences a ciegas (el bug
// original) tomaba como bloque cualquier par de ```, incluidos los de ejemplo
// anidados en un fence de 4, y hacía que un marcador que era solo documentación
// pareciera texto real.
function inSpans(spans, idx) {
  for (const [a, b] of spans) if (idx >= a && idx < b) return true;
  return false;
}

function chunkNames(raw) {
  const content = String(raw ?? '');
  const spans = fenceSpans(content);
  const names = [];
  const re = /<!--\s*CHUNK:\s*([\w-]+)\s*-->/g;
  let m;
  while ((m = re.exec(content))) if (!inSpans(spans, m.index)) names.push(m[1]);
  return names;
}

function extractChunks(raw, wanted) {
  const content = String(raw ?? '');
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
  exitUsage(`loader.mjs: ${motivo}\n\n${USAGE}`);
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
        const desc = s.description ?? (() => { try { return summaryLine(readFrontmatter(readText(s.path)).description, 80); } catch { return ''; } })();
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
      const content = readText(s.path);
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
    const content = readText(s.path);
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
    const content = readText(s.path);
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
    // Sin comando el uso sigue yendo a STDOUT (comportamiento documentado y
    // fijado por la suite): core.exitUsage lo mandaría a stderr.
    console.log(USAGE);
    process.exit(1);
}
