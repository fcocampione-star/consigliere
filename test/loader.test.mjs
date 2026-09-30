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
 * que esta en .gitignore — y solo desde `list`/`refresh` (ver la suite
 * "loader solo lectura": load/chunk/search no la tocan).
 *
 * El parseo de front-matter SI se afirma: los SKILL.md de este repo estan en
 * CRLF, que era justo el caso roto (descripciones vacias y validacion de
 * chunks saltada). Para el caso del BOM, que el repo no tiene, hay una suite
 * propia con un sandbox: se copia el loader a un arbol temporal, de modo que
 * su PROJECT_ROOT derivado de la ubicacion resuelve ahi y se le puede dar un
 * SKILL.md con BOM + CRLF sin tocar los del repo.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, tmpdir, runAll } from './harness.mjs';

const REPO = join(import.meta.dirname, '..');
const LOADER = join(REPO, '.opencode', 'skills', '_skill-loader', 'loader.mjs');
// Biblioteca compartida que el loader importa (`.opencode/scripts/lib/`): los
// sandboxes tienen que copiarla o el import falla antes de ejecutar nada.
const LIB_FILES = ['core.mjs', 'md.mjs', 'cache.mjs'];
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
// `script` permite apuntar a una copia en un sandbox (mismo binario, otro
// PROJECT_ROOT derivado de su propia ubicacion).
function run(args = [], script = LOADER) {
  const res = spawnSync(process.execPath, [script, ...args], {
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

test('cada description de listado cabe en UNA linea (los bloques | se aplanan)', () => {
  // `description: |` es un bloque escalar: su valor trae saltos de línea. Sin
  // aplanarlos, cada skill se imprimía partida en varias líneas (bug que solo
  // estaba tapado porque el parseo CRLF devolvía descripciones vacías).
  for (const s of JSON.parse(run(['list', '--json']).out)) {
    assert(!/[\r\n]/.test(s.description), `la description cacheada de ${s.name} tiene saltos de linea`);
    assert(!/^\s|\s$/.test(s.description), `la description de ${s.name} no tiene blancos en los bordes`);
  }
  const filas = lineas(run(['list']).out);
  eq(filas.length, JSON.parse(run(['list', '--json']).out).length, 'list: exactamente una linea por skill');
  for (const h of JSON.parse(run(['search', TERM, '--json']).out)) {
    assert(!/[\r\n]/.test(h.description), `la description del hit ${h.name} tiene saltos de linea`);
  }
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

test('search sin termino es un error de uso, no "cero resultados" (exit 1 + uso)', () => {
  const r = run(['search']);
  eq(r.code, 1, 'exit code de uso invalido');
  eq(r.out, '', 'nada por stdout cuando falta la query');
  includes(r.err, 'Uso:', 'imprime el uso documentado');
  includes(r.err, 'falta la query', 'dice que falta la query');
  for (const cmd of ['list', 'refresh', 'search', 'load', 'chunk']) includes(r.err, cmd, `el uso menciona ${cmd}`);
  assert(!r.err.includes('"undefined"'), 'ya no imprime el literal "undefined"');
});

test('search con la query en blanco tambien es un error de uso', () => {
  const r = run(['search', '   ']);
  eq(r.code, 1, 'exit code de uso invalido');
  includes(r.err, 'Uso:', 'imprime el uso documentado');
});

test('search --json sin query no busca el literal "--json": es un error de uso', () => {
  const r = run(['search', '--json']);
  eq(r.code, 1, 'un flag no cuenta como query');
  includes(r.err, 'Uso:', 'imprime el uso documentado');
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

test('chunk sin nombre de chunk es un error de uso, no devuelve la skill entera', () => {
  const r = run(['chunk', SKILL]);
  eq(r.code, 1, 'exit code de uso invalido');
  eq(r.out, '', 'no se vuelca la skill entera por stdout');
  includes(r.err, 'Uso:', 'imprime el uso documentado');
  includes(r.err, 'faltan los chunks', 'dice que faltan los chunks');
  assert(!r.out.includes('<!-- CHUNK:'), 'ningun contenido de chunk sale sin pedirlo');
});

test('chunk con el nombre de chunk en blanco tambien es un error de uso', () => {
  const r = run(['chunk', SKILL, '  ']);
  eq(r.code, 1, 'exit code de uso invalido');
  includes(r.err, 'Uso:', 'imprime el uso documentado');
});

test('load sin nombre de skill es un error de uso', () => {
  const r = run(['load']);
  eq(r.code, 1, 'exit code de uso invalido');
  includes(r.err, 'Uso:', 'imprime el uso documentado');
  includes(r.err, 'falta el nombre', 'dice que falta el nombre');
});

// ── Front-matter en CRLF (los SKILL.md del repo ESTAN en CRLF) ──────────────
// El fallo original: el patrón de front-matter exigía un \n desnudo tras el
// delimitador, así que en CRLF no casaba, readFrontmatter devolvía {} y cada
// skill se quedaba sin description — y validateSkill se saltaba entero
// porque su fm.chunksList quedaba undefined.
suite('loader front-matter (CRLF en el repo real)');

test('list --json trae la description real de cada skill del repo (no null)', () => {
  const skills = JSON.parse(run(['list', '--json']).out);
  assert(skills.length > 0, 'debe listar al menos una skill');
  for (const s of skills) {
    assert(typeof s.description === 'string' && s.description.length > 0, `description vacia en ${s.name} (front-matter no parseado)`);
    assert(!/^[\s]/.test(s.description), `description de ${s.name} no empieza con blanco`);
  }
});

test('la description de list viene del front-matter real del SKILL.md', () => {
  const skills = JSON.parse(run(['list', '--json']).out);
  const s = skills.find((x) => x.name === SKILL);
  const crudo = readFileSync(SKILL_PATH, 'utf8');
  const primeraLineaDesc = (crudo.match(/^description: \|\r?\n {2}(.+)$/m) || [])[1];
  assert(primeraLineaDesc, 'el fixture debe tener description en bloque (|)');
  includes(s.description, primeraLineaDesc.trim(), 'la description cacheada es la del archivo');
});

test('load imprime la description completa (bloque | multilinea), no vacia', () => {
  const r = run(['load', SKILL]);
  eq(r.code, 0, 'exit code');
  const m = r.out.match(/^Description: ([\s\S]*?)$/m);
  assert(m, 'linea Description presente');
  assert(m[1].trim().length > 0, 'Description no puede venir vacia con el bug de CRLF');
  match(m[1], /Documentaci/i, 'la description real del SKILL.md');
});

test('la cache en disco trae la description de cada skill', () => {
  const cache = JSON.parse(readFileSync(join(REPO, '.advisor', 'skill-registry.cache.json'), 'utf8'));
  eq(cache.version, 2, 'el formato de cache sigue siendo v2');
  assert(Array.isArray(cache.entries) && cache.entries.length > 0, 'la cache tiene entradas');
  for (const e of cache.entries) {
    assert(typeof e.description === 'string' && e.description.length > 0, `entrada de cache sin description: ${e.name}`);
  }
});

// ── Sandbox: BOM + CRLF y fences complicados ───────────────────────────────
// El repo no tiene ningun SKILL.md con BOM ni fences que rompan el emparejado
// ingenuo, asi que el caso se monta en un arbol temporal: se copia el loader
// (byte identico) a <tmp>/.opencode/skills/_skill-loader/ para que su
// PROJECT_ROOT = HERE/../../.. resuelva al tmp, y se le da un SKILL.md con BOM,
// CRLF y fences de ~~~, indentados y de 4 backticks.
const SB_SKILL = '_sandbox';

const SB_BODY = [
  '---',
  'name: _sandbox',
  'description: |',
  '  Descripcion con BOM y CRLF.',
  '  Segunda linea del bloque.',
  'chunks: [alpha, beta, fantasma]',
  '---',
  '',
  '# Sandbox',
  '',
  '<!-- CHUNK: alpha -->',
  'Contenido alpha.',
  '<!-- /CHUNK -->',
  '',
  '~~~',
  '<!-- CHUNK: en-tilde -->',
  'NO-DEBE-SALIR tilde',
  '<!-- /CHUNK -->',
  '~~~',
  '',
  '  ```js',
  '<!-- CHUNK: indentado -->',
  'NO-DEBE-SALIR indentado',
  '<!-- /CHUNK -->',
  '  ```',
  '',
  '````',
  '<!-- CHUNK: largo -->',
  'NO-DEBE-SALIR largo',
  '<!-- /CHUNK -->',
  '```',
  '````',
  '',
  '<!-- CHUNK: beta -->',
  'Contenido beta.',
  '<!-- /CHUNK -->',
  '',
].join('\n');

function makeSandbox() {
  const dir = join(tmpdir('advisor-loader'), 'arbol');
  const skills = join(dir, '.opencode', 'skills');
  mkdirSync(join(skills, '_skill-loader'), { recursive: true });
  mkdirSync(join(skills, SB_SKILL), { recursive: true });
  copyFileSync(LOADER, join(skills, '_skill-loader', 'loader.mjs'));
  // El loader importa la biblioteca compartida del harness (`.opencode/scripts/lib/`)
  // a través del árbol del proyecto, así que el sandbox tiene que traerla también:
  // sin ella, el import falla antes de ejecutar ningún comando.
  const lib = join(dir, '.opencode', 'scripts', 'lib');
  mkdirSync(lib, { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(REPO, '.opencode', 'scripts', 'lib', f), join(lib, f));
  // BOM UTF-8 + CRLF: el par que rompia el parseo de front-matter.
  writeFileSync(join(skills, SB_SKILL, 'SKILL.md'), '﻿' + SB_BODY.replace(/\n/g, '\r\n'), 'utf8');
  return { dir, loader: join(skills, '_skill-loader', 'loader.mjs'), cache: join(dir, '.advisor', 'skill-registry.cache.json') };
}

const SB = makeSandbox();
process.on('exit', () => rmSync(join(SB.dir, '..'), { recursive: true, force: true }));

suite('loader front-matter con BOM + CRLF (sandbox)');

test('list --json del sandbox trae la description del bloque multilinea', () => {
  const r = run(['list', '--json'], SB.loader);
  eq(r.code, 0, 'exit code');
  const skills = JSON.parse(r.out);
  const s = skills.find((x) => x.name === SB_SKILL);
  assert(s, 'el sandbox lista su skill');
  includes(s.description, 'Descripcion con BOM y CRLF.', 'primera linea del bloque');
  includes(s.description, 'Segunda linea del bloque.', 'segunda linea del bloque');
});

test('load del sandbox con BOM + CRLF: description poblada y chunks correctos', () => {
  const r = run(['load', SB_SKILL], SB.loader);
  eq(r.code, 0, 'exit code');
  const m = r.out.match(/^Description: ([\s\S]*?)$/m);
  assert(m && m[1].trim().length > 0, 'Description no vacia: el BOM/CRLF ya no rompe el parseo');
  includes(m[1], 'Descripcion con BOM y CRLF.', 'description real');
  // Solo alpha y beta estan FUERA de fences; los demas estan dentro de fences
  // (tilde, indentado y de 4 backticks con un cierre de 3 que no cierra).
  const c = r.out.match(/^Chunks: (.*)$/m);
  eq(c[1], 'alpha, beta', 'los chunks dentro de fences no cuentan como marcadores reales');
});

test('chunk all del sandbox no arrastra marcadores que viven dentro de fences', () => {
  const r = run(['chunk', SB_SKILL, 'all'], SB.loader);
  eq(r.code, 0, 'exit code');
  eq(marcasEn(r.out), ['alpha', 'beta'], 'solo los chunks reales fuera de fences');
  assert(!r.out.includes('NO-DEBE-SALIR'), 'el contenido de dentro de los fences no se extrae');
});

test('un chunk pedido dentro de un fence no existe: sale con 1', () => {
  const r = run(['chunk', SB_SKILL, 'largo'], SB.loader);
  eq(r.code, 1, 'exit code de error');
  includes(r.err, 'no tiene chunks', 'mensaje documentado');
});

test('la validacion de chunks YA NO se salta (CRLF roto la dejaba en undefined)', () => {
  const r = run(['load', SB_SKILL], SB.loader);
  eq(r.code, 0, 'un aviso no es un fallo: load sigue en 0');
  includes(r.err, 'declara "fantasma" sin marcador', 'detecta el chunk declarado sin marcador real');
  assert(!r.err.includes('declara "alpha" sin marcador'), 'no inventa avisos para los chunks que si existen');
});

// ── Solo lectura: la cache no se escribe al leer ────────────────────────────
suite('loader solo lectura: la cache no se escribe al leer');

test('load/chunk/search no crean la cache; list si la genera', () => {
  const cache = join(REPO, '.advisor', 'skill-registry.cache.json');
  const habia = existsSync(cache);
  const previo = habia ? readFileSync(cache, 'utf8') : null;
  try {
    if (habia) rmSync(cache, { force: true });
    for (const args of [['load', SKILL], ['chunk', SKILL, 'urls'], ['search', TERM]]) {
      const r = run(args);
      assert(r.code === 0, `${args[0]} debe salir con 0: ${r.err.slice(0, 80)}`);
      assert(!existsSync(cache), `${args[0]} NO debe escribir ${cache} (leer no muta estado)`);
    }
    const r = run(['list']);
    eq(r.code, 0, 'list sale con 0');
    assert(existsSync(cache), 'list (el comando de listado) si genera la cache');
  } finally {
    if (!habia && existsSync(cache)) rmSync(cache, { force: true });
    else if (habia && previo !== null) writeFileSync(cache, previo, 'utf8');
  }
});

test('el sandbox de solo lectura tampoco escribe cache al leer', () => {
  rmSync(SB.cache, { force: true });
  for (const args of [['load', SB_SKILL], ['chunk', SB_SKILL, 'alpha'], ['search', 'sandbox']]) {
    const r = run(args, SB.loader);
    assert(r.code === 0, `${args[0]} debe salir con 0`);
    assert(!existsSync(SB.cache), `${args[0]} no debe crear la cache del sandbox`);
  }
  eq(run(['refresh'], SB.loader).code, 0, 'refresh si la crea');
  assert(existsSync(SB.cache), 'refresh genera la cache');
});

// ── Escritura de la cache: atómica y con el error VISIBLE ────────────────────
// La cache es la última escritura que quedaba fuera del temp+rename, y su fallo
// se tragaba: un destino ilegible pasaba por cache "escrita". Se afirma el
// comportamiento, no el texto: (a) la escritura va por writeAtomic de lib/core,
// (b) si no se puede escribir, el comando AVISA por stderr y sigue.
suite('loader · escritura de la cache');

test('la cache se escribe con writeAtomic de lib/core (no con writeFileSync directo)', () => {
  const src = readFileSync(LOADER, 'utf8');
  const tpl = readFileSync(join(REPO, 'templates', '.opencode', 'skills', '_skill-loader', 'loader.mjs'), 'utf8');
  assert(/import \{[^}]*\bwriteAtomic\b[^}]*\} from '\.\.\/\.\.\/scripts\/lib\/core\.mjs'/.test(src),
    'el loader debe importar writeAtomic de lib/core.mjs');
  // Código sin comentarios: el contrato es sobre lo que se EJECUTA, así que ni
  // el JSDoc ni las notas que nombran el patrón viejo cuentan como uso.
  const codigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert(!/writeFileSync/.test(codigo(src)), 'ninguna escritura directa en el loader');
  assert(!/writeFileSync/.test(codigo(tpl)), 'ninguna escritura directa en la copia de templates/ (espejo byte a byte)');
});

test('una cache que no se puede escribir avisa por stderr y no rompe list/refresh', () => {
  // `.advisor` pasa a ser un FICHERO: mkdir/writeFile del destino fallan con
  // ENOTDIR en cualquier SO, que es la forma portable de romper la escritura sin
  // depender de permisos (que en Windows no sirven para esto).
  const dir = join(tmpdir('advisor-loader'), 'cache-rota');
  rmSync(dir, { recursive: true, force: true });
  const skills = join(dir, '.opencode', 'skills');
  mkdirSync(join(skills, '_skill-loader'), { recursive: true });
  copyFileSync(LOADER, join(skills, '_skill-loader', 'loader.mjs'));
  const lib = join(dir, '.opencode', 'scripts', 'lib');
  mkdirSync(lib, { recursive: true });
  for (const f of LIB_FILES) copyFileSync(join(REPO, '.opencode', 'scripts', 'lib', f), join(lib, f));
  mkdirSync(join(skills, SB_SKILL), { recursive: true });
  writeFileSync(join(skills, SB_SKILL, 'SKILL.md'), '---\nname: _sandbox\ndescription: d\n---\n\n# S\n', 'utf8');
  const loader = join(skills, '_skill-loader', 'loader.mjs');
  const rota = join(dir, '.advisor');
  rmSync(rota, { recursive: true, force: true });
  writeFileSync(rota, 'no soy un directorio\n', 'utf8');
  try {
    for (const args of [['list'], ['refresh']]) {
      const r = run(args, loader);
      eq(r.code, 0, `${args[0]} sigue saliendo con 0: la cache es un derivado, no un requisito`);
      assert(lineas(r.out).length > 0, `${args[0]} imprime el listado igualmente`);
      includes(r.err, 'no se pudo escribir la cache', `${args[0]} avisa del fallo de escritura`);
      includes(r.err, 'skill-registry.cache.json', 'el aviso nombra la ruta que no pudo escribirse');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await runAll();
