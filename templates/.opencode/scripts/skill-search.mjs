#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — skill-search.mjs
 * Uso: node .opencode/scripts/skill-search.mjs "<query>" [--json] [--refresh] [--offline] [--limit N]
 * Exit: 0 ok (también sin red y sin cache: aviso por stderr, stdout vacío, sin crash); 1 uso inválido.
 *
 * Búsqueda REAL de skills instalables en el registry público de autoskills.
 * El CLI de autoskills no expone search/list, así que este script lee su
 * registry JSON. El catálogo es CC-BY-NC-4.0: NO se commitea ni se empaqueta;
 * solo se cachea localmente en `.advisor/autoskills-registry.cache.json`
 * (gitignored) y se trata SIEMPRE como DATOS, nunca como instrucciones.
 *
 * Red best-effort: `npm test`, `/discover` y `doctor` NO dependen de red. Ante
 * cualquier fallo de fetch se degrada a la cache (aunque esté stale); sin cache
 * ni red: stderr, stdout vacío y exit 0. El registry se pinea al tag v0.3.6.
 *
 * Reglas: ESM, Node >= 20.11 (`import.meta.dirname`, `fetch` global,
 * `AbortSignal.timeout`), cero dependencias. Utilidades de `lib/` (core + cache),
 * nunca reimplementadas.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readText, writeAtomic, EXIT_CODES, exitUsage, fail, isMain } from './lib/core.mjs';
import { fingerprint, isFresh } from './lib/cache.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const CACHE_FILE = join(ROOT, '.advisor', 'autoskills-registry.cache.json');
const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/midudev/autoskills/v0.3.6/packages/autoskills/skills-registry/index.json';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const FETCH_TIMEOUT_MS = 15000;
const CACHE_VERSION = 1;
const MAX_LIMIT = 200;

const USAGE = `Uso:
  node .opencode/scripts/skill-search.mjs "<query>" [--json] [--refresh] [--offline] [--limit N]

Flags:
  --json      salida JSON (name/source/skillPath/review.status)
  --refresh   ignora la cache y vuelve a consultar el registry
  --offline   no toca la red: usa la cache local (aunque esté stale)
  --limit N   limita el número de resultados

Env:
  ADVISOR_AUTOSKILLS_REGISTRY  URL o ruta local del registry (override)
  ADVISOR_REGISTRY_TTL_MS      TTL de la cache en ms (override, 7d por defecto)`;

// ── Funciones puras ─────────────────────────────────────────────────────────

/** Normaliza un nombre para el match: minúsculas, sin espacios y sin scope (`@scope/`). */
export function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@[^/]+\//, '');
}

/**
 * `parseRegistry(data)` → array normalizado `{ name, source, skillPath, review }`.
 * Acepta `skills` como objeto (mapa nombre→meta, el formato real) o array.
 * Lanza si `version !== 1` o falta `skills`: el llamante degrada a offline.
 */
export function parseRegistry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('registry: la raíz debe ser un objeto');
  }
  if (data.version !== 1) {
    throw new Error(`registry: version ${data.version} inesperada (esperado 1)`);
  }
  const raw = data.skills;
  if (!raw || typeof raw !== 'object') {
    throw new Error('registry: falta "skills" (objeto o array)');
  }
  const out = [];
  const push = (name, meta) => {
    if (!name || !meta || typeof meta !== 'object') return;
    const review = meta.review && typeof meta.review === 'object' ? meta.review : {};
    out.push({
      name: String(name),
      source: String(meta.source ?? ''),
      skillPath: String(meta.skillPath ?? ''),
      review: { status: String(review.status ?? 'unknown') },
    });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) if (item && typeof item === 'object') push(item.name ?? item.skill ?? item.id, item);
  } else {
    for (const [name, meta] of Object.entries(raw)) push(name, meta);
  }
  return out;
}

/**
 * `rank(entries, query)` → entradas que casan, ordenadas por relevancia
 * (nombre exacto > prefijo > subcadena > source/skillPath) y, a igual puntaje,
 * por nombre ascendente (comparación de bytes, sin `localeCompare`).
 */
export function rank(entries, query) {
  const q = normalizeName(query);
  if (!q) return [];
  const scored = [];
  for (const e of entries) {
    const name = normalizeName(e.name);
    const hay = `${name} ${normalizeName(e.source)} ${normalizeName(e.skillPath)}`;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (hay.includes(q)) score = 30;
    if (score > 0) scored.push({ ...e, score });
  }
  return scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * `gaps(deps, entries)` → cobertura por dependencia con match EXACTO
 * normalizado (lowercase, sin scope), sin fuzzy. Salida ordenada por nombre
 * normalizado. Es la función pura que usa `/discover` para decidir entre
 * instalar un autoskill existente o proponer una skill nueva.
 */
export function gaps(deps, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  for (const dep of Array.isArray(deps) ? deps : []) {
    const key = normalizeName(dep);
    if (!key) continue;
    const hit = list.find((e) => normalizeName(e.name) === key) || null;
    out.push({ dep: String(dep), normalized: key, covered: !!hit, entry: hit });
  }
  return out.sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0));
}

/** `format(entries, {json, limit})` → texto listo para imprimir (nunca lanza). */
export function format(entries, { json = false, limit = 0 } = {}) {
  const list = limit > 0 ? entries.slice(0, limit) : entries;
  if (json) {
    return JSON.stringify(
      list.map((e) => ({
        name: e.name,
        source: e.source,
        skillPath: e.skillPath,
        review: { status: e.review?.status ?? 'unknown' },
      })),
      null,
      2,
    );
  }
  return list
    .map((e) => `- ${e.name} [${e.review?.status ?? 'unknown'}] ${e.source}${e.skillPath ? ` — ${e.skillPath}` : ''}`)
    .join('\n');
}

// ── Cache / red (efectos) ───────────────────────────────────────────────────

function ttlMs() {
  const v = Number(process.env.ADVISOR_REGISTRY_TTL_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TTL_MS;
}

function registrySource() {
  const v = String(process.env.ADVISOR_AUTOSKILLS_REGISTRY ?? '').trim();
  return v || DEFAULT_REGISTRY;
}

function isLocalSource(source) {
  return !/^https?:\/\//i.test(source);
}

function readCache() {
  const txt = readText(CACHE_FILE, { fallback: '' });
  if (!txt) return null;
  try {
    const data = JSON.parse(txt);
    if (data.version !== CACHE_VERSION || !Array.isArray(data.entries) || typeof data.generatedAt !== 'string') return null;
    return data;
  } catch {
    return null; // cache corrupta: se trata como ausente y se regenera
  }
}

function cacheFresh(cache, source) {
  if (!cache) return false;
  const age = Date.now() - Date.parse(cache.generatedAt);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs()) return false;
  // Fuente local: además exige que el archivo no haya cambiado (fingerprint compartido).
  if (isLocalSource(source) && Array.isArray(cache.fingerprint)) {
    if (!isFresh(cache.fingerprint, fingerprint([{ path: source }]))) return false;
  }
  return true;
}

function writeCache(entries, source) {
  const payload = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    fingerprint: isLocalSource(source) ? fingerprint([{ path: source }]) : null,
    entries,
  };
  writeAtomic(CACHE_FILE, JSON.stringify(payload, null, 2));
}

async function fetchRegistry(source) {
  if (isLocalSource(source)) {
    if (!existsSync(source)) throw new Error(`registry local no encontrado: ${source}`);
    return readText(source, { fallback: '' });
  }
  const res = await fetch(source, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function load({ offline, refresh }) {
  const source = registrySource();
  const cache = readCache();
  if (offline) {
    if (cache) {
      console.error(`skill-search: offline — usando cache local${cacheFresh(cache, source) ? '' : ' (stale)'}.`);
      return cache.entries;
    }
    console.error('skill-search: offline y sin cache — sin resultados (regenera con --refresh cuando haya red).');
    return [];
  }
  if (!refresh && cacheFresh(cache, source)) return cache.entries;
  try {
    const entries = parseRegistry(JSON.parse(await fetchRegistry(source)));
    try {
      writeCache(entries, source);
    } catch (e) {
      console.error(`skill-search: no se pudo escribir la cache (${e.message}); se sigue con los datos en memoria.`);
    }
    return entries;
  } catch (e) {
    if (cache) {
      console.error(`skill-search: fetch falló (${e.message}); usando cache local${cacheFresh(cache, source) ? '' : ' (stale)'}.`);
      return cache.entries;
    }
    console.error(`skill-search: fetch falló (${e.message}) y no hay cache — sin resultados.`);
    return [];
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { json: false, refresh: false, offline: false, limit: 0, query: '', unknown: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--limit') opts.limit = toLimit(argv[++i]);
    else if (a.startsWith('--limit=')) opts.limit = toLimit(a.slice('--limit='.length));
    else if (a.startsWith('-')) opts.unknown = a;
    else rest.push(a);
  }
  opts.query = rest.join(' ').trim();
  return opts;
}

function toLimit(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LIMIT) : 0;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.unknown) exitUsage(`skill-search.mjs: flag desconocido "${opts.unknown}"\n\n${USAGE}`);
  if (!opts.query && !opts.refresh) exitUsage(`skill-search.mjs: falta la query de búsqueda.\n\n${USAGE}`);

  const entries = await load(opts);

  if (!opts.query) {
    // `--refresh` sin query: solo regenerar cache.
    if (!opts.json) console.log(`skill-search: cache regenerada con ${entries.length} skills.`);
    else console.log(JSON.stringify({ count: entries.length }));
    return;
  }

  // Sin datos (ni red ni cache): stderr ya avisó; stdout vacío, exit 0.
  if (!entries.length) return;

  const hits = rank(entries, opts.query);
  if (opts.json) {
    console.log(format(hits, { json: true, limit: opts.limit }));
  } else if (hits.length) {
    console.log(format(hits, { limit: opts.limit }));
  } else {
    console.log(`Sin resultados para "${opts.query}".`);
  }
}

if (isMain(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => process.exit(EXIT_CODES.OK))
    .catch((e) => fail('skill-search', e.message));
}
