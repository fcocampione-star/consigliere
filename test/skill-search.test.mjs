#!/usr/bin/env node
/**
 * test/skill-search.test.mjs — suite de `.opencode/scripts/skill-search.mjs`.
 *
 * Dos capas:
 *  1. Funciones puras importadas (`parseRegistry`, `rank`, `format`, `gaps`,
 *     `normalizeName`): el módulo tiene guard `isMain`, así que importarlo NO
 *     dispara el CLI.
 *  2. CLI real como PROCESO HIJO en un sandbox (copia del script + lib/ en un
 *     árbol temporal, de modo que su ROOT derivado de la ubicación resuelve
 *     ahí). NUNCA toca la red: el registry se sirve desde un fixture SINTÉTICO
 *     local (2-3 entradas inventadas, no una copia del catálogo CC-BY-NC-4.0) o
 *     desde una cache pre-escrita. Los casos de fallo usan una ruta local
 *     inexistente, que falla al instante sin DNS.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, tmpdir, cleanup, runAll } from './harness.mjs';
import { parseRegistry, rank, format, gaps, normalizeName } from '../.opencode/scripts/skill-search.mjs';

const REPO = join(import.meta.dirname, '..');
const SCRIPT = join(REPO, '.opencode', 'scripts', 'skill-search.mjs');
const LIB_FILES = ['core.mjs', 'cache.mjs'];
const MAX_BUFFER = 16 * 1024 * 1024;

// Registry SINTÉTICO (esquema real: version + skills mapa nombre→meta).
const FIXTURE = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  reviewer: { model: 'fixture', promptVersion: '1.0.0' },
  skills: {
    vue: { source: 'antfu/skills', skillPath: 'antfu/skills/vue', review: { status: 'approved', flags: [] } },
    bun: { source: 'midudev/autoskills', skillPath: 'midudev/autoskills/bun', review: { status: 'approved' } },
    'svelte-code-writer': { source: 'sveltejs/ai-tools', skillPath: 'sveltejs/ai-tools/svelte-code-writer', review: { status: 'pending' } },
  },
};

const CLAVES_JSON = ['name', 'review', 'skillPath', 'source'];

// ── Puras: parseRegistry ────────────────────────────────────────────────────

suite('skill-search · parseRegistry');

test('normaliza el mapa de skills a un array name/source/skillPath/review', () => {
  const entries = parseRegistry(FIXTURE);
  eq(entries.length, 3, 'tres skills');
  for (const e of entries) {
    eq(Object.keys(e).sort(), ['name', 'review', 'skillPath', 'source'], `claves de ${e.name}`);
    eq(Object.keys(e.review).sort(), ['status'], `review de ${e.name}`);
    assert(typeof e.name === 'string' && e.name.length > 0, 'name no vacío');
  }
  eq(entries.find((e) => e.name === 'svelte-code-writer').review.status, 'pending', 'review.status preservado');
});

test('acepta también la forma array', () => {
  const entries = parseRegistry({ version: 1, skills: [{ name: 'alpha', source: 's', skillPath: 'p', review: { status: 'approved' } }] });
  eq(entries, [{ name: 'alpha', source: 's', skillPath: 'p', review: { status: 'approved' } }], 'un elemento');
});

test('review ausente o malformada cae a status "unknown" (nunca lanza)', () => {
  const entries = parseRegistry({ version: 1, skills: { x: { source: 's', skillPath: 'p' } } });
  eq(entries[0].review.status, 'unknown', 'sin review -> unknown');
});

test('version !== 1 lanza', () => {
  let lanzó = false;
  try { parseRegistry({ version: 2, skills: {} }); } catch { lanzó = true; }
  eq(lanzó, true, 'version 2 no es válida');
});

test('falta skills o la raíz no es objeto: lanza', () => {
  for (const bad of [{ version: 1 }, { version: 1, skills: null }, null, [], 'x']) {
    let lanzó = false;
    try { parseRegistry(bad); } catch { lanzó = true; }
    eq(lanzó, true, `debe lanzar con ${JSON.stringify(bad)}`);
  }
});

// ── Puras: rank ─────────────────────────────────────────────────────────────

suite('skill-search · rank');

const ENTRIES = parseRegistry(FIXTURE);

test('el match exacto de nombre va primero', () => {
  const hits = rank(ENTRIES, 'vue');
  eq(hits[0].name, 'vue', 'exacto primero');
  eq(hits[0].score, 100, 'puntaje exacto');
});

test('match por prefijo, subcadena y por source/skillPath', () => {
  eq(rank(ENTRIES, 'svelte')[0].name, 'svelte-code-writer', 'prefijo');
  eq(rank(ENTRIES, 'writer')[0].name, 'svelte-code-writer', 'subcadena');
  eq(rank(ENTRIES, 'antfu')[0].name, 'vue', 'source');
});

test('insensible a mayúsculas y al scope', () => {
  eq(rank(ENTRIES, 'VUE')[0].name, 'vue', 'mayúsculas');
  eq(rank(ENTRIES, '@antfu/vue')[0].name, 'vue', 'scope quitado');
});

test('sin coincidencias: array vacío', () => {
  eq(rank(ENTRIES, 'zzz-nada'), [], 'sin hits');
  eq(rank(ENTRIES, '   '), [], 'query en blanco');
});

test('determinista: a igual puntaje ordena por nombre (bytes)', () => {
  const tie = [
    { name: 'zeta', source: 'src/x', skillPath: 'src/x/zeta', review: { status: 'approved' } },
    { name: 'alpha', source: 'src/x', skillPath: 'src/x/alpha', review: { status: 'approved' } },
  ];
  eq(rank(tie, 'src').map((e) => e.name), ['alpha', 'zeta'], 'empate resuelto por nombre');
  eq(rank(ENTRIES, 's'), rank(ENTRIES, 's'), 'misma query -> mismo orden');
});

// ── Puras: gaps (match EXACTO normalizado, sin fuzzy) ───────────────────────

suite('skill-search · gaps');

test('match exacto normalizado; el scope se ignora', () => {
  const g = gaps(['Vue', '@antfu/vue', 'bun'], ENTRIES);
  eq(g.map((x) => x.normalized), ['bun', 'vue', 'vue'], 'normalizado y ordenado');
  assert(g.every((x) => x.covered), 'las tres cubiertas');
});

test('sin fuzzy: un nombre más largo NO cubre la dependencia exacta', () => {
  const g = gaps(['svelte'], ENTRIES);
  eq(g[0].covered, false, '"svelte" no casa con "svelte-code-writer"');
});

test('dependencia no cubierta: entry null y salida ordenada', () => {
  const g = gaps(['react', 'angular', 'bun'], ENTRIES);
  eq(g.map((x) => x.normalized), ['angular', 'bun', 'react'], 'orden alfabético');
  eq(g.find((x) => x.normalized === 'react').covered, false, 'react sin cobertura');
  eq(g.find((x) => x.normalized === 'react').entry, null, 'sin entry');
  eq(g.find((x) => x.normalized === 'bun').covered, true, 'bun cubierta');
});

test('normalizeName: minúsculas, trim y sin scope', () => {
  eq(normalizeName('  @Scope/Name '), 'name', 'scope + trim + lowercase');
  eq(normalizeName(''), '', 'vacío');
  eq(normalizeName(undefined), '', 'undefined');
});

// ── Puras: format ───────────────────────────────────────────────────────────

suite('skill-search · format');

test('--json emite name/source/skillPath/review.status', () => {
  const parsed = JSON.parse(format(ENTRIES, { json: true }));
  assert(Array.isArray(parsed), 'array');
  for (const e of parsed) {
    eq(Object.keys(e).sort(), CLAVES_JSON, `claves de ${e.name}`);
    eq(Object.keys(e.review).sort(), ['status'], `review de ${e.name}`);
  }
});

test('limit recorta; 0 no recorta', () => {
  eq(JSON.parse(format(ENTRIES, { json: true, limit: 1 })).length, 1, 'limit 1');
  eq(JSON.parse(format(ENTRIES, { json: true })).length, 3, 'sin límite');
});

test('texto: una línea por skill con nombre y status; vacío -> ""', () => {
  const out = format(ENTRIES, {});
  eq(out.split('\n').length, 3, 'tres líneas');
  match(out, /^- vue \[approved\] /m, 'formato de línea');
  eq(format([], {}), '', 'sin entradas -> cadena vacía');
});

// ── CLI en sandbox (sin red) ────────────────────────────────────────────────

function makeSandbox() {
  const dir = tmpdir('advisor-skill-search');
  const scripts = join(dir, '.opencode', 'scripts');
  mkdirSync(scripts, { recursive: true });
  copyFileSync(SCRIPT, join(scripts, 'skill-search.mjs'));
  const lib = join(scripts, 'lib');
  mkdirSync(lib, { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(REPO, '.opencode', 'scripts', 'lib', f), join(lib, f));
  const fixture = join(dir, 'registry.json');
  writeFileSync(fixture, JSON.stringify(FIXTURE, null, 2), 'utf8');
  return {
    dir,
    script: join(scripts, 'skill-search.mjs'),
    fixture,
    missing: join(dir, 'no-existe.json'),
    cache: join(dir, '.advisor', 'autoskills-registry.cache.json'),
  };
}

const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));
function sandbox() {
  const sb = makeSandbox();
  TEMPS.push(sb.dir);
  return sb;
}

function run(sb, args, env = {}) {
  const res = spawnSync(process.execPath, [sb.script, ...args], {
    cwd: sb.dir,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, ADVISOR_AUTOSKILLS_REGISTRY: sb.fixture, ...env },
  });
  assert(!res.error, `spawn falló: ${res.error && res.error.message}`);
  assert(res.signal === null, `no debe morir por señal (${res.signal})`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

const readCache = (sb) => JSON.parse(readFileSync(sb.cache, 'utf8'));

suite('skill-search CLI · cache y refresh');

test('--refresh consulta el registry y escribe la cache local', () => {
  const sb = sandbox();
  const r = run(sb, ['--refresh']);
  eq(r.code, 0, 'exit 0');
  assert(existsSync(sb.cache), 'la cache se creó');
  const cache = readCache(sb);
  eq(cache.version, 1, 'version de cache');
  eq(cache.entries.length, 3, 'entradas cacheadas');
  eq(cache.source, sb.fixture, 'source registrado');
  includes(r.out, '3', 'reporta el número de skills');
});

test('tras refrescar, --offline sirve resultados desde la cache (sin red)', () => {
  const sb = sandbox();
  run(sb, ['--refresh']);
  const r = run(sb, ['--offline', 'vue', '--json']);
  eq(r.code, 0, 'exit 0');
  const parsed = JSON.parse(r.out);
  eq(parsed[0].name, 'vue', 'encuentra vue en cache');
  eq(parsed[0].review.status, 'approved', 'status correcto');
});

test('cache fresca (fuente remota) se usa sin consultar el registry', () => {
  const sb = sandbox();
  const remote = 'https://registry.example.invalid/index.json';
  mkdirSync(join(sb.dir, '.advisor'), { recursive: true });
  writeFileSync(sb.cache, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), source: remote, fingerprint: null, entries: parseRegistry(FIXTURE) }, null, 2), 'utf8');
  // Aunque la fuente apunte a un host inválido, la cache fresca evita el fetch.
  const r = run(sb, ['vue', '--json'], { ADVISOR_AUTOSKILLS_REGISTRY: remote });
  eq(r.code, 0, 'exit 0');
  eq(JSON.parse(r.out)[0].name, 'vue', 'sale de la cache');
  eq(r.err, '', 'sin avisos de red');
});

test('cache stale por TTL: reintenta el fetch y cae a la cache si falla', () => {
  const sb = sandbox();
  mkdirSync(join(sb.dir, '.advisor'), { recursive: true });
  writeFileSync(sb.cache, JSON.stringify({ version: 1, generatedAt: '2000-01-01T00:00:00.000Z', source: sb.missing, fingerprint: null, entries: parseRegistry(FIXTURE) }, null, 2), 'utf8');
  const r = run(sb, ['vue', '--json'], { ADVISOR_AUTOSKILLS_REGISTRY: sb.missing });
  eq(r.code, 0, 'exit 0');
  eq(JSON.parse(r.out)[0].name, 'vue', 'sirve la cache stale');
  match(r.err, /fetch falló|usando cache/i, 'avisa del fallback por stderr');
});

test('la fuente local cambia: el fingerprint invalida la cache y se relee', () => {
  const sb = sandbox();
  run(sb, ['--refresh']);
  const bigger = { ...FIXTURE, skills: { ...FIXTURE.skills, remix: { source: 's', skillPath: 's/remix', review: { status: 'approved' } } } };
  writeFileSync(sb.fixture, JSON.stringify(bigger, null, 2), 'utf8');
  const r = run(sb, ['remix', '--json']);
  eq(r.code, 0, 'exit 0');
  eq(JSON.parse(r.out)[0].name, 'remix', 'relee el fixture cambiado');
});

test('cache corrupta se trata como ausente y se regenera', () => {
  const sb = sandbox();
  mkdirSync(join(sb.dir, '.advisor'), { recursive: true });
  writeFileSync(sb.cache, '{ esto no es json', 'utf8');
  const r = run(sb, ['bun', '--json']);
  eq(r.code, 0, 'exit 0');
  eq(JSON.parse(r.out)[0].name, 'bun', 'funciona pese a la cache rota');
  eq(readCache(sb).version, 1, 'cache regenerada');
});

suite('skill-search CLI · degradación offline (exit 0, sin crash)');

test('--offline sin cache: stderr, stdout vacío, exit 0', () => {
  const sb = sandbox();
  const r = run(sb, ['--offline', 'vue']);
  eq(r.code, 0, 'exit 0');
  eq(r.out, '', 'stdout vacío');
  match(r.err, /offline/i, 'avisa por stderr');
  assert(!existsSync(sb.cache), 'no inventa una cache');
});

test('sin cache y fetch fallido: stderr, stdout vacío, exit 0', () => {
  const sb = sandbox();
  const r = run(sb, ['vue'], { ADVISOR_AUTOSKILLS_REGISTRY: sb.missing });
  eq(r.code, 0, 'exit 0');
  eq(r.out, '', 'stdout vacío');
  match(r.err, /fetch falló/i, 'avisa por stderr');
});

suite('skill-search CLI · consultas y uso');

test('sin coincidencias con datos: mensaje / [] según modo', () => {
  const sb = sandbox();
  run(sb, ['--refresh']);
  includes(run(sb, ['zzz-nada']).out, 'Sin resultados', 'texto');
  eq(JSON.parse(run(sb, ['zzz-nada', '--json']).out), [], 'json vacío');
});

test('--limit N recorta los resultados', () => {
  const sb = sandbox();
  run(sb, ['--refresh']);
  const r = run(sb, ['s', '--json', '--limit', '1']);
  eq(JSON.parse(r.out).length, 1, 'un solo resultado');
});

test('--refresh sin query no falla; query ausente sin --refresh es uso inválido', () => {
  const sb = sandbox();
  eq(run(sb, ['--refresh']).code, 0, 'refresh sin query: ok');
  const r = run(sb, []);
  eq(r.code, 1, 'sin query: uso inválido');
  includes(r.err, 'Uso:', 'imprime el uso');
});

test('un flag desconocido es uso inválido', () => {
  const r = run(sandbox(), ['--nope', 'vue']);
  eq(r.code, 1, 'exit 1');
  includes(r.err, 'Uso:', 'imprime el uso');
});

test('el script no contiene placeholders {{VAR}} de plantilla', () => {
  neq(/\{\{[A-Z_]+\}\}/.test(readFileSync(SCRIPT, 'utf8')), true, 'sin {{VAR}}');
});

await runAll();
