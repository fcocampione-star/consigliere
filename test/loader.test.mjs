#!/usr/bin/env node
/**
 * test/loader.test.mjs — suite de caracterizacion de
 * `.opencode/skills/_skill-loader/loader.mjs` ejecutado como PROCESO HIJO.
 *
 * Por que hijo y no import: el loader resuelve PROJECT_ROOT desde su propia
 * ubicacion (linea 21) y ejecuta el `switch` de comandos en el cuerpo del
 * modulo (lineas 197-272, con `process.exit` en los caminos de error), asi que
 * no se puede importar sin disparar un comando ni apuntarlo a un arbol
 * temporal. Se ejecuta el binario real contra el repo real con `spawnSync` y
 * se afirman solo los comandos de lectura y su forma de salida documentada.
 *
 * Los comandos probados son de solo lectura para el repo; el unico archivo que
 * el loader puede escribir es su cache `.advisor/skill-registry.cache.json`,
 * que esta en .gitignore.
 *
 * DELIBERADAMENTE no se afirma nada sobre el parseo de front-matter (por ejemplo
 * que `description` venga poblada): los SKILL.md del repo estan en CRLF y esa
 * es una linea rota conocida que se arregla en un cambio posterior.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, runAll } from './harness.mjs';

const REPO = join(import.meta.dirname, '..');
const LOADER = join(REPO, '.opencode', 'skills', '_skill-loader', 'loader.mjs');
const MAX_BUFFER = 16 * 1024 * 1024;

// Anclas del repo: skills que existen en `.opencode/skills/` de este repo.
const SKILL = '_project-docs';
const SKILL_SDD = '_sdd-lite';
const SKILL_LOADER = '_skill-loader';
const SKILL_PATH = join(REPO, '.opencode', 'skills', SKILL, 'SKILL.md');
const FUENTES = ['proyecto', 'autoskill'];
const CLAVES_LIST_JSON = ['cached', 'description', 'name', 'path', 'source'];
const CLAVES_HIT_JSON = ['description', 'name', 'source'];

// Termino de busqueda que existe en el contenido de _sdd-lite/SKILL.md.
const TERM = 'rfc2119';
const SIN_MATCH = 'zzz-sin-coincidencia-zzz';

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Corre el loader real como hijo y devuelve codigo + stdout + stderr.
function run(args = []) {
  const res = spawnSync(process.execPath, [LOADER, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  assert(!res.error, `spawn de loader.mjs fallo: ${res.error && res.error.message}`);
  assert(res.signal === null, `loader.mjs no deberia morir por senal (fue ${res.signal})`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

function lineas(out) {
  return out.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
}

// Verdad de terreno: los marcadores de chunk que hay de verdad en el SKILL.md,
// en orden de documento. Se compara contra ella en vez de hardcodear la lista.
function chunksReales(skill = SKILL) {
  const texto = readFileSync(join(REPO, '.opencode', 'skills', skill, 'SKILL.md'), 'utf8');
  const out = [];
  const re = /<!--\s*CHUNK:\s*([\w-]+)\s*-->/g;
  let m;
  while ((m = re.exec(texto))) out.push(m[1]);
  return out;
}

function marcasEn(out) {
  const found = [];
  const re = /<!--\s*CHUNK:\s*([\w-]+)\s*-->/g;
  let m;
  while ((m = re.exec(out))) found.push(m[1]);
  return found;
}

// ── list ─────────────────────────────────────────────────────────────────────

suite('loader list');

test('list sale con 0 e imprime una linea por skill con el formato documentado', () => {
  const r = run(['list']);
  eq(r.code, 0, 'exit code');
  eq(r.err, '', 'sin errores en stderr');
  const filas = lineas(r.out);
  assert(filas.length > 0, 'debe listar al menos una skill');
  // La descripcion puede ir vacia (trailing), asi que tras el separador se
  // acepta "nada" o "algo": no se afirma su contenido.
  const re = new RegExp('^- \\S+ \\[(?:' + FUENTES.map(esc).join('|') + ')\\](?: \\(cache\\))? \u2014(?: .*)?$');
  for (const f of filas) match(f, re, `linea con el formato "- nombre [fuente] - descripcion": ${f.slice(0, 60)}`);
});

test('list incluye las skills del repo', () => {
  const r = run(['list']);
  for (const s of [SKILL, SKILL_SDD, SKILL_LOADER]) {
    match(r.out, new RegExp('^- ' + esc(s) + ' \\[(?:' + FUENTES.map(esc).join('|') + ')\\]', 'm'), `debe listar ${s}`);
  }
});

test('list --json emite un array con la forma { name, source, path, description, cached }', () => {
  const r = run(['list', '--json']);
  eq(r.code, 0, 'exit code');
  const parsed = JSON.parse(r.out);
  assert(Array.isArray(parsed), 'la raiz debe ser un array');
  assert(parsed.length > 0, 'debe listar al menos una skill');
  for (const s of parsed) {
    eq(Object.keys(s).sort(), CLAVES_LIST_JSON, `claves de la skill ${s.name}`);
    assert(typeof s.name === 'string' && s.name.length > 0, 'name no vacio');
    assert(FUENTES.includes(s.source), `source de ${s.name} debe ser ${FUENTES.join('|')}: ${s.source}`);
    assert(typeof s.path === 'string' && s.path.endsWith('SKILL.md'), `path de ${s.name} debe acabar en SKILL.md`);
    assert(typeof s.cached === 'boolean', `cached de ${s.name} debe ser booleano`);
    assert(s.description === null || typeof s.description === 'string', `description de ${s.name} debe ser string o null`);
  }
});

test('los modos texto y --json de list coinciden en conjunto y orden de skills', () => {
  const texto = run(['list']).out;
  const json = JSON.parse(run(['list', '--json']).out);
  const delTexto = lineas(texto).map((l) => l.match(/^- (\S+) /)[1]);
  eq(delTexto, json.map((s) => s.name), 'los mismos nombres en el mismo orden');
});

test('el path de cada skill apunta al SKILL.md de la ubicacion real', () => {
  const json = JSON.parse(run(['list', '--json']).out);
  for (const s of json) {
    const esperado = join(REPO, '.opencode', 'skills', s.name, 'SKILL.md');
    eq(s.path, esperado, `path de ${s.name}`);
  }
});

test('cada path listado existe en disco', () => {
  const json = JSON.parse(run(['list', '--json']).out);
  for (const s of json) {
    assert(existsSync(s.path), `debería existir ${s.path}`);
  }
});

test('list --refresh no cambia el conjunto de skills (solo regenera la cache)', () => {
  const antes = JSON.parse(run(['list', '--json']).out).map((s) => s.name);
  const r = run(['list', '--refresh']);
  eq(r.code, 0, 'exit code');
  match(r.out, /^- \S+ \[(?:proyecto|autoskill)\]/m, 'sigue imprimiendo la lista');
  eq(JSON.parse(run(['list', '--json']).out).map((s) => s.name), antes, 'el mismo conjunto de skills tras refrescar');
});

// ── search ───────────────────────────────────────────────────────────────────

suite('loader search');

test('search con un termino existente devuelve las skills que lo contienen (--json)', () => {
  const r = run(['search', TERM, '--json']);
  eq(r.code, 0, 'exit code');
  const parsed = JSON.parse(r.out);
  assert(Array.isArray(parsed), 'la raiz debe ser un array');
  const nombres = parsed.map((h) => h.name);
  assert(nombres.includes(SKILL_SDD), `${TERM} deberia encontrar ${SKILL_SDD}, encontro: ${nombres.join(', ')}`);
  for (const h of parsed) {
    eq(Object.keys(h).sort(), CLAVES_HIT_JSON, `claves del hit ${h.name}`);
    assert(FUENTES.includes(h.source), `source de ${h.name} debe ser ${FUENTES.join('|')}`);
    assert(typeof h.description === 'string', `description de ${h.name} debe ser string`);
  }
});

test('search en modo texto imprime "- nombre [fuente]: descripcion"', () => {
  const r = run(['search', TERM]);
  eq(r.code, 0, 'exit code');
  const filas = lineas(r.out);
  assert(filas.length > 0, 'debe encontrar algo');
  const re = new RegExp('^- \\S+ \\[(?:' + FUENTES.map(esc).join('|') + ')\\]:(?: .*)?$');
  for (const f of filas) match(f, re, `linea de resultado con el formato documentado: ${f}`);
  assert(!r.out.includes('Sin resultados'), 'no debe caer en la rama de sin resultados');
});

test('search sin coincidencias imprime el mensaje documentado y sale con 0', () => {
  const r = run(['search', SIN_MATCH]);
  eq(r.code, 0, 'sin resultados no es un error');
  includes(r.out, `Sin resultados para "${SIN_MATCH}".`, 'mensaje documentado con el termino usado');
  eq(JSON.parse(run(['search', SIN_MATCH, '--json']).out), [], 'en --json devuelve un array vacio');
});

test('search sin termino no es error: sale con 0 y sin resultados', () => {
  const r = run(['search']);
  eq(r.code, 0, 'exit code');
  includes(r.out, 'Sin resultados', 'sin query no hay coincidencias');
});

test('los resultados de search son un subconjunto de las skills de list', () => {
  const listadas = new Set(JSON.parse(run(['list', '--json']).out).map((s) => s.name));
  for (const h of JSON.parse(run(['search', TERM, '--json']).out)) {
    assert(listadas.has(h.name), `${h.name} deberia estar en list`);
  }
});

// ── chunk ────────────────────────────────────────────────────────────────────

suite('loader chunk');

test('chunk imprime el bloque pedido con su marcador de apertura', () => {
  const r = run(['chunk', SKILL, 'urls']);
  eq(r.code, 0, 'exit code');
  match(r.out, /^<!-- CHUNK: urls -->/, 'primera linea: marcador del chunk pedido');
  includes(r.out, 'https://', 'el contenido del chunk');
});

test('chunk devuelve solo el bloque pedido, no los demas', () => {
  const r = run(['chunk', SKILL, 'urls']);
  eq(marcasEn(r.out), ['urls'], 'solo aparece el marcador del chunk pedido');
});

test('chunk con varios nombres devuelve cada bloque una vez', () => {
  const r = run(['chunk', SKILL, 'urls,shortcuts']);
  eq(r.code, 0, 'exit code');
  const marcas = marcasEn(r.out);
  eq(marcas, ['urls', 'shortcuts'], 'los dos marcadores, en orden de documento');
  assert(r.out.indexOf('<!-- CHUNK: urls -->') < r.out.indexOf('<!-- CHUNK: shortcuts -->'), 'urls antes que shortcuts');
});

test('chunk con "all" devuelve exactamente los chunks declarados en el SKILL.md', () => {
  const r = run(['chunk', SKILL, 'all']);
  eq(r.code, 0, 'exit code');
  eq(marcasEn(r.out), chunksReales(), 'todos los marcadores del archivo, en orden');
  assert(chunksReales().length > 1, 'el fixture debe tener mas de un chunk');
});

test('chunk con espacios alrededor de los nombres los tolera', () => {
  const r = run(['chunk', SKILL, ' urls , shortcuts ']);
  eq(r.code, 0, 'exit code');
  eq(marcasEn(r.out), ['urls', 'shortcuts'], 'los espacios se recortan');
});

test('chunk inexistente en una skill existente sale con 1 y lista los disponibles', () => {
  const r = run(['chunk', SKILL, 'no-existe']);
  eq(r.code, 1, 'exit code de error');
  includes(r.err, 'no tiene chunks', 'mensaje documentado');
  includes(r.err, chunksReales().join(','), 'el error lista los chunks que si existen');
  eq(r.out, '', 'nada por stdout cuando falla');
});

// ── load ─────────────────────────────────────────────────────────────────────

suite('loader load');

test('load imprime cabecera, path, description y la lista de chunks', () => {
  const r = run(['load', SKILL]);
  eq(r.code, 0, 'exit code');
  const ls = lineas(r.out);
  eq(ls[0], `# ${SKILL} [proyecto]`, 'primera linea: "# nombre [fuente]"');
  match(r.out, /^Path: .*SKILL\.md$/m, 'linea Path con el archivo real');
  match(r.out, /^Description: /m, 'linea Description presente aunque su valor pueda ir vacio');
  includes(r.out, `Chunks: ${chunksReales().join(', ')}`, 'la lista de chunks coincide con los marcadores reales');
});

test('load de una skill inexistente sale con 1 con el mensaje documentado', () => {
  const r = run(['load', 'no-existe']);
  eq(r.code, 1, 'exit code de error');
  includes(r.err, 'Skill "no-existe" no encontrada.', 'mensaje documentado');
  assert(!r.out.includes('# '), 'no imprime la cabecera de una skill inexistente');
});

// ── Errores de invocacion ────────────────────────────────────────────────────

suite('loader errores de invocacion');

test('chunk de una skill inexistente sale con 1', () => {
  const r = run(['chunk', 'no-existe', 'all']);
  eq(r.code, 1, 'exit code de error');
  includes(r.err, 'Skill "no-existe" no encontrada.', 'mensaje documentado');
});

test('sin comando imprime el uso documentado y sale con 1', () => {
  const r = run([]);
  eq(r.code, 1, 'exit code de error');
  includes(r.out, 'Uso:', 'cabecera de uso');
  for (const cmd of ['list', 'refresh', 'search', 'load', 'chunk']) {
    includes(r.out, cmd, `el uso menciona ${cmd}`);
  }
});

test('un comando desconocido cae en el mismo uso y sale con 1', () => {
  const r = run(['no-existe-comando']);
  eq(r.code, 1, 'exit code de error');
  includes(r.out, 'Uso:', 'mismo bloque de uso que sin comando');
  neq(r.out, '', 'imprime el uso');
});

await runAll();
