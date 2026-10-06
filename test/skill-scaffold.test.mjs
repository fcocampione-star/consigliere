#!/usr/bin/env node
/**
 * test/skill-scaffold.test.mjs — suite de `.opencode/scripts/skill-scaffold.mjs`.
 *
 * Dos capas:
 *  1. Funciones puras importadas (`validateName`, `normalizeChunks`, `render`):
 *     el módulo tiene guard `isMain`, así que importarlo NO dispara el CLI.
 *  2. CLI real como PROCESO HIJO en un sandbox (script + lib/ en un árbol
 *     temporal). La salida del scaffold se valida contra `loader.mjs` REAL
 *     ejecutado también como hijo (no se importa: ejecuta el switch al
 *     importar), copiando el loader y la lib al mismo sandbox.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, tmpdir, cleanup, runAll } from './harness.mjs';
import { validateName, normalizeChunks, render } from '../.opencode/scripts/skill-scaffold.mjs';

const REPO = join(import.meta.dirname, '..');
const SCRIPT = join(REPO, '.opencode', 'scripts', 'skill-scaffold.mjs');
const LOADER = join(REPO, '.opencode', 'skills', '_skill-loader', 'loader.mjs');
const LIB_FILES = ['core.mjs', 'md.mjs', 'cache.mjs'];
const MAX_BUFFER = 16 * 1024 * 1024;

// ── Puras: validateName ─────────────────────────────────────────────────────

suite('skill-scaffold · validateName');

test('acepta nombres kebab válidos', () => {
  for (const n of ['a', 'my-skill', 'skill2', 'a1-b2-c3']) eq(validateName(n), null, `${n} debe ser válido`);
});

test('rechaza vacío, mayúsculas, guion inicial, guion bajo y espacios', () => {
  for (const n of ['', '   ', 'My-Skill', '-bad', '_bad', 'bad name', 'bad.skill', 'ñandu']) {
    assert(validateName(n) !== null, `${JSON.stringify(n)} debe ser inválido`);
  }
});

test('rechaza nombres de más de 64 caracteres', () => {
  assert(validateName('a'.repeat(64)) === null, '64 exactos válidos');
  assert(validateName('a'.repeat(65)) !== null, '65 inválido');
});

// ── Puras: normalizeChunks ──────────────────────────────────────────────────

suite('skill-scaffold · normalizeChunks');

test('sin entrada usa el default', () => {
  eq(normalizeChunks(''), ['urls', 'patterns', 'shortcuts'], 'default');
  eq(normalizeChunks(undefined), ['urls', 'patterns', 'shortcuts'], 'undefined');
});

test('recorta, baja a minúsculas y deduplica', () => {
  eq(normalizeChunks(' URLs , patterns,urls '), ['urls', 'patterns'], 'limpio y deduplicado');
});

test('un chunk inválido lanza', () => {
  let lanzó = false;
  try { normalizeChunks('urls, bad chunk'); } catch { lanzó = true; }
  eq(lanzó, true, 'chunk con espacio inválido');
});

// ── Puras: render ───────────────────────────────────────────────────────────

suite('skill-scaffold · render');

test('frontmatter con name == directorio, description de UNA línea y chunks declarados', () => {
  const out = render('mi-skill', 'Una   descripción\ncon salto', ['urls', 'patterns']);
  match(out, /^---\nname: mi-skill\n/, 'name en el frontmatter');
  assert(!/description:[^\n]*\n[^\n]*\n---/.test(out.split('---')[1] || ''), 'la description no lleva saltos');
  includes(out, 'chunks: [urls, patterns]', 'chunks declarados');
});

test('un marcador <!-- CHUNK: x --> por chunk', () => {
  const out = render('mi-skill', 'd', ['urls', 'patterns', 'shortcuts']);
  for (const c of ['urls', 'patterns', 'shortcuts']) includes(out, `<!-- CHUNK: ${c} -->`, `marcador de ${c}`);
  eq((out.match(/<!-- CHUNK:/g) || []).length, 3, 'exactamente tres marcadores');
});

// ── CLI en sandbox ──────────────────────────────────────────────────────────

function makeSandbox() {
  const dir = tmpdir('advisor-skill-scaffold');
  const scripts = join(dir, '.opencode', 'scripts');
  const lib = join(scripts, 'lib');
  mkdirSync(lib, { recursive: true });
  copyFileSync(SCRIPT, join(scripts, 'skill-scaffold.mjs'));
  for (const f of LIB_FILES) copyFileSync(join(REPO, '.opencode', 'scripts', 'lib', f), join(lib, f));
  const loaderDir = join(dir, '.opencode', 'skills', '_skill-loader');
  mkdirSync(loaderDir, { recursive: true });
  copyFileSync(LOADER, join(loaderDir, 'loader.mjs'));
  return { dir, script: join(scripts, 'skill-scaffold.mjs'), loader: join(loaderDir, 'loader.mjs') };
}

const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));
function sandbox() {
  const sb = makeSandbox();
  TEMPS.push(sb.dir);
  return sb;
}

function run(sb, args) {
  const res = spawnSync(process.execPath, [sb.script, ...args], { cwd: sb.dir, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  assert(!res.error, `spawn falló: ${res.error && res.error.message}`);
  assert(res.signal === null, `no debe morir por señal (${res.signal})`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

const target = (sb, name) => join(sb.dir, '.opencode', 'skills', name, 'SKILL.md');

suite('skill-scaffold CLI · dry-run vs --write');

test('sin --write imprime el esqueleto por stdout y NO escribe', () => {
  const sb = sandbox();
  const r = run(sb, ['demo-skill', '--description', 'Una demo']);
  eq(r.code, 0, 'exit 0');
  match(r.out, /^---\nname: demo-skill\n/, 'esqueleto por stdout');
  includes(r.out, '<!-- CHUNK: urls -->', 'con chunks');
  assert(!existsSync(target(sb, 'demo-skill')), 'no creó el archivo en dry-run');
});

test('con --write crea .opencode/skills/<name>/SKILL.md', () => {
  const sb = sandbox();
  const r = run(sb, ['demo-skill', '--description', 'Una demo', '--chunks', 'urls,patterns', '--write']);
  eq(r.code, 0, 'exit 0');
  const f = target(sb, 'demo-skill');
  assert(existsSync(f), 'archivo creado');
  const content = readFileSync(f, 'utf8');
  eq(content, render('demo-skill', 'Una demo', ['urls', 'patterns']), 'contenido determinista');
});

test('no sobrescribe sin --force; con --force sí', () => {
  const sb = sandbox();
  run(sb, ['demo-skill', '--description', 'original', '--write']);
  const before = readFileSync(target(sb, 'demo-skill'), 'utf8');
  const r = run(sb, ['demo-skill', '--description', 'nueva', '--write']);
  eq(r.code, 1, 'sin --force: error');
  includes(r.err, 'ya existe', 'mensaje claro');
  eq(readFileSync(target(sb, 'demo-skill'), 'utf8'), before, 'el archivo no cambió');
  const r2 = run(sb, ['demo-skill', '--description', 'nueva', '--write', '--force']);
  eq(r2.code, 0, 'con --force: ok');
  includes(readFileSync(target(sb, 'demo-skill'), 'utf8'), 'nueva', 'sobrescrito');
});

test('nombre inválido es uso inválido (exit 1) y no escribe', () => {
  const sb = sandbox();
  const r = run(sb, ['Bad_Name', '--write']);
  eq(r.code, 1, 'exit 1');
  includes(r.err, 'Uso:', 'imprime el uso');
  assert(!existsSync(target(sb, 'Bad_Name')), 'no escribió nada');
});

// ── La salida es válida para loader.mjs (proceso hijo real) ─────────────────

function runLoader(sb, args) {
  const res = spawnSync(process.execPath, [sb.loader, ...args], { cwd: sb.dir, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  assert(!res.error, `spawn de loader.mjs falló: ${res.error && res.error.message}`);
  assert(res.signal === null, 'loader.mjs no debe morir por señal');
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

suite('skill-scaffold · salida válida para loader.mjs');

test('loader list --json reconoce la skill scaffoldeada (name y description)', () => {
  const sb = sandbox();
  run(sb, ['demo-skill', '--description', 'Una demo valida', '--chunks', 'urls,patterns', '--write']);
  const r = runLoader(sb, ['list', '--json']);
  eq(r.code, 0, 'loader list exit 0');
  const skills = JSON.parse(r.out);
  const s = skills.find((x) => x.name === 'demo-skill');
  assert(s, 'la skill aparece en el listado');
  eq(s.source, 'proyecto', 'fuente proyecto');
  includes(s.description, 'Una demo valida', 'description parseada');
});

test('loader chunk all devuelve exactamente los chunks scaffoldeados', () => {
  const sb = sandbox();
  run(sb, ['demo-skill', '--chunks', 'urls,patterns', '--write']);
  const r = runLoader(sb, ['chunk', 'demo-skill', 'all']);
  eq(r.code, 0, 'chunk exit 0');
  const marcas = [...r.out.matchAll(/<!-- CHUNK: ([\w-]+) -->/g)].map((m) => m[1]);
  eq(marcas, ['urls', 'patterns'], 'los marcadores coinciden con el frontmatter');
});

test('loader load no emite avisos de chunks (name y chunks coherentes)', () => {
  const sb = sandbox();
  run(sb, ['demo-skill', '--description', 'd', '--chunks', 'urls,patterns,shortcuts', '--write']);
  const r = runLoader(sb, ['load', 'demo-skill']);
  eq(r.code, 0, 'load exit 0');
  eq(r.err, '', 'sin avisos: name == directorio y cada chunk tiene su marcador');
});

await runAll();
