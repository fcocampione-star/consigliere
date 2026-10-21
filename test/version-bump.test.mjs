#!/usr/bin/env node
/**
 * test/version-bump.test.mjs — caracterización de `.opencode/scripts/version-bump.mjs`.
 *
 * Dos capas, sin tocar la versión real del repo:
 *  1. El CORE puro (`bump(root, opts)`) sobre un fixture en tmpdir con los 5
 *     destinos + `package.json`: patch/minor/major, plan, rollback y EOL.
 *  2. El CLI sobre el mismo fixture (copia del script + su lib): exit codes
 *     0/1/2/3, `--dry-run` sin escrituras y `--set` idempotente.
 *
 * El fixture reproduce las tres trampas reales: `init.ps1` va con BOM + CRLF
 * (un write-back normalizado a LF viaja así al tarball), las dos `SKILL.md`
 * llevan un `metadata.version` que NO es la versión del harness (no debe
 * tocarse) y `package.json` se reescribe in-place (nada de reformatear).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { suite, test, assert, eq, includes, tmpdir, cleanup, runAll } from './harness.mjs';
import { bump } from '../.opencode/scripts/version-bump.mjs';

const REPO = join(import.meta.dirname, '..');
const SCRIPTS = join(REPO, '.opencode', 'scripts');
const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

const SKILL = (v) => [
  '---',
  'name: _project-docs',
  'metadata:',
  '  version: 1.0.0',
  '---',
  '',
  '# Docs',
  '',
  `| npm advisor-harness | https://www.npmjs.com/package/advisor-harness | v${v} via npx advisor-harness@latest |`,
  '',
].join('\n');

function write(path, text) {
  writeFileSync(path, text, 'utf8');
}

/** Fixture completo: 5 destinos + package.json, más la copia del CLI y su lib. */
function sandbox(version = '1.0.0') {
  const dir = tmpdir('advisor-bump');
  TEMPS.push(dir);
  const scripts = join(dir, '.opencode', 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  for (const f of ['version-bump.mjs', 'version-check.mjs']) copyFileSync(join(SCRIPTS, f), join(scripts, f));
  copyFileSync(join(SCRIPTS, 'lib', 'core.mjs'), join(scripts, 'lib', 'core.mjs'));

  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'advisor-harness', version, files: ['init.mjs'] }, null, 2)}\n`, 'utf8');
  write(join(dir, 'init.mjs'), `#!/usr/bin/env node\nconst VERSION = '${version}';\nconsole.log(VERSION);\n`);
  write(join(dir, 'init.sh'), `#!/usr/bin/env bash\n# lanzador\nVERSION="${version}"\nexec node init.mjs "$@"\n`);
  // BOM + CRLF: el EOL canónico de los `.ps1` (regresión EOL de este test).
  write(join(dir, 'init.ps1'), `\uFEFF# lanzador PowerShell\n$HARNESS_VERSION = "${version}"\n& node init.mjs @args\n`.replace(/\n/g, '\r\n'));
  mkdirSync(join(dir, '.opencode', 'skills', '_project-docs'), { recursive: true });
  mkdirSync(join(dir, 'templates', '.opencode', 'skills', '_project-docs'), { recursive: true });
  write(join(dir, '.opencode', 'skills', '_project-docs', 'SKILL.md'), SKILL(version));
  write(join(dir, 'templates', '.opencode', 'skills', '_project-docs', 'SKILL.md'), SKILL(version));

  return { dir, cli: join(scripts, 'version-bump.mjs') };
}

function run(cli, args = []) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, input: '', timeout: 15000 });
  assert(!r.error, `spawn version-bump.mjs falló: ${r.error && r.error.message}`);
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const pkgVersion = (dir) => JSON.parse(read(dir, 'package.json')).version;

// ── Suite 1: core puro ──────────────────────────────────────────────────────
suite('version-bump · core');

test('patch: sube los 5 destinos + package.json y deja intacto metadata.version', () => {
  const { dir } = sandbox('1.0.0');
  const out = bump(dir, { kind: 'patch' });
  eq(out.current, '1.0.0', 'versión de partida');
  eq(out.next, '1.0.1', 'patch = +1 en el patch');
  eq(pkgVersion(dir), '1.0.1', 'package.json actualizado');
  assert(read(dir, 'init.mjs').includes("const VERSION = '1.0.1'"), 'init.mjs actualizado');
  assert(read(dir, 'init.sh').includes('VERSION="1.0.1"'), 'init.sh actualizado');
  assert(read(dir, 'init.ps1').includes('$HARNESS_VERSION = "1.0.1"'), 'init.ps1 actualizado');
  for (const rel of ['.opencode/skills/_project-docs/SKILL.md', 'templates/.opencode/skills/_project-docs/SKILL.md']) {
    assert(read(dir, rel).includes('v1.0.1 via npx advisor-harness@latest'), `${rel}: ancla actualizada`);
    assert(read(dir, rel).includes('  version: 1.0.0'), `${rel}: metadata.version (versión de la skill) NO se toca`);
  }
});

test('plan: 6 entradas y package.json la ÚLTIMA (se escribe al final)', () => {
  const { dir } = sandbox('1.0.0');
  const { plan } = bump(dir, { kind: 'patch' });
  eq(plan.length, 6, '5 destinos + package.json');
  eq(plan[plan.length - 1], { file: 'package.json', from: '1.0.0', to: '1.0.1', count: 1 }, 'package.json al final');
  eq(plan.map((p) => p.count), [1, 1, 1, 1, 1, 1], 'una sola ocurrencia por fichero');
  eq(plan.filter((p) => p.file === '.opencode/skills/_project-docs/SKILL.md').length, 1, 'SKILL.md de raíz en el plan');
  eq(plan.filter((p) => p.file === 'templates/.opencode/skills/_project-docs/SKILL.md').length, 1, 'SKILL.md de templates en el plan');
});

test('minor y major respetan semver (1.2.3 → 1.3.0 / 2.0.0)', () => {
  const a = sandbox('1.2.3');
  eq(bump(a.dir, { kind: 'minor' }).next, '1.3.0', 'minor');
  eq(pkgVersion(a.dir), '1.3.0', 'minor escrito');

  const b = sandbox('1.2.3');
  eq(bump(b.dir, { kind: 'major' }).next, '2.0.0', 'major');
  eq(read(b.dir, 'init.mjs').includes("const VERSION = '2.0.0'"), true, 'major escrito');
});

test('package.json se reescribe in-place: solo cambia el valor de "version"', () => {
  const { dir } = sandbox('1.0.0');
  const antes = read(dir, 'package.json');
  bump(dir, { kind: 'patch' });
  eq(read(dir, 'package.json'), antes.replace('"version": "1.0.0"', '"version": "1.0.1"'), 'cero churn de formato');
});

test('init.ps1 conserva BOM + CRLF tras el bump (regresión EOL/tarball)', () => {
  const { dir } = sandbox('1.0.0');
  bump(dir, { kind: 'patch' });
  const raw = readFileSync(join(dir, 'init.ps1'));
  eq(raw[0], 0xef, 'BOM UTF-8 intacto');
  const txt = raw.toString('utf8');
  assert(!txt.replace(/\r\n/g, '').includes('\n'), 'ningún LF desnudo: el .ps1 sigue CRLF puro');
  assert(txt.includes('$HARNESS_VERSION = "1.0.1"\r\n'), 'la línea de versión es CRLF');
});

test('dry-run del core: devuelve plan sin escribir nada', () => {
  const { dir } = sandbox('1.0.0');
  const antes = read(dir, 'package.json');
  const out = bump(dir, { kind: 'major', dryRun: true });
  eq(out.next, '2.0.0', 'plan calculado');
  eq(out.plan.length, 6, 'plan completo');
  eq(read(dir, 'package.json'), antes, 'package.json intacto');
  assert(read(dir, 'init.mjs').includes("const VERSION = '1.0.0'"), 'destinos intactos');
});

test('drift preexistente: DRIFT (2) y no escribe nada', () => {
  const { dir } = sandbox('1.0.0');
  write(join(dir, 'init.sh'), '#!/usr/bin/env bash\nVERSION="0.9.9"\n');
  const err = (() => { try { bump(dir, { kind: 'patch' }); return null; } catch (e) { return e; } })();
  assert(err, 'bump lanza con drift');
  eq(err.code, 2, 'exit 2 (drift)');
  includes(err.message, 'init.sh: declara v0.9.9', 'el mensaje nombra el destino desalineado');
  eq(pkgVersion(dir), '1.0.0', 'package.json sin tocar');
});

test('destino sin exactamente 1 ocurrencia: MATCH (3) y no escribe ninguno', () => {
  // a) constante ausente
  const a = sandbox('1.0.0');
  write(join(a.dir, 'init.mjs'), '#!/usr/bin/env node\nconst VERSION_TAG = "1.0.0";\n');
  const e1 = (() => { try { bump(a.dir, { kind: 'patch' }); return null; } catch (e) { return e; } })();
  eq(e1 && e1.code, 3, 'constante ausente → 3');
  includes(e1.message, 'init.mjs: 0 ocurrencias', 'el mensaje dice cuántas encontró');
  eq(pkgVersion(a.dir), '1.0.0', 'no se escribió package.json');

  // b) constante duplicada (2 ocurrencias): tampoco vale
  const b = sandbox('1.0.0');
  write(join(b.dir, 'init.sh'), '#!/usr/bin/env bash\nVERSION="1.0.0"\nVERSION="1.0.0"\n');
  const e2 = (() => { try { bump(b.dir, { kind: 'patch' }); return null; } catch (e) { return e; } })();
  eq(e2 && e2.code, 3, 'duplicada → 3');
  includes(e2.message, '2 ocurrencias', 'el mensaje cuenta las 2');
});

test('--set: aplica la versión exacta, idempotente si ya está y rechaza bajar', () => {
  const { dir } = sandbox('1.0.0');
  const sube = bump(dir, { set: '1.4.0' });
  eq(sube.next, '1.4.0', 'set aplicado');
  eq(pkgVersion(dir), '1.4.0', 'escrito');

  const igual = bump(dir, { set: '1.4.0' });
  eq(igual.changed, false, 'misma versión → nada que hacer');
  eq(igual.plan, [], 'sin plan');

  const baja = (() => { try { bump(dir, { kind: null, set: '1.3.9' }); return null; } catch (e) { return e; } })();
  eq(baja && baja.code, 1, 'bajar de versión → uso (1)');
  eq(pkgVersion(dir), '1.4.0', 'la versión no baja');
});

test('semver estricto: prerelease/build y kind desconocido son error de uso', () => {
  const { dir } = sandbox('1.0.0');
  for (const bad of ['1.1.0-beta.1', '1.1', '01.2.3', '1.2.3+build']) {
    const e = (() => { try { bump(dir, { set: bad }); return null; } catch (err) { return err; } })();
    eq(e && e.code, 1, `--set ${bad} → 1`);
  }
  const kind = (() => { try { bump(dir, { kind: 'huge' }); return null; } catch (err) { return err; } })();
  eq(kind && kind.code, 1, 'kind desconocido → 1');
});

// ── Suite 2: CLI sobre el fixture ───────────────────────────────────────────
suite('version-bump · CLI');

test('CLI patch: exit 0, escribe los 6 y anuncia el siguiente paso', () => {
  const s = sandbox('1.0.0');
  const r = run(s.cli, ['patch']);
  eq(r.status, 0, `exit 0 (${r.err.trim()})`);
  includes(r.out, '✅ package.json 1.0.0 → 1.0.1', 'resumen con el salto de versión');
  includes(r.out, 'tag v1.0.1', 'recordatorio del tag');
  eq(pkgVersion(s.dir), '1.0.1', 'version:bump real aplicado');
});

test('CLI --dry-run: exit 0, tabla ruta|from → to|ocurrencias y disco intacto', () => {
  const s = sandbox('1.0.0');
  const r = run(s.cli, ['patch', '--dry-run']);
  eq(r.status, 0, 'exit 0');
  includes(r.out, 'dry-run', 'cabecera de dry-run');
  includes(r.out, 'init.ps1 | 1.0.0 → 1.0.1 | 1 ocurrencia', 'fila de la tabla');
  includes(r.out, 'package.json | 1.0.0 → 1.0.1 | 1 ocurrencia', 'package.json en la tabla');
  eq(pkgVersion(s.dir), '1.0.0', 'no escribe package.json');
  assert(read(s.dir, 'init.mjs').includes("const VERSION = '1.0.0'"), 'no escribe destinos');
});

test('CLI: drift preexistente → 2; ocurrencia ausente → 3 (sin escribir)', () => {
  const drift = sandbox('1.0.0');
  write(join(drift.dir, '.opencode', 'skills', '_project-docs', 'SKILL.md'), SKILL('0.1.0'));
  const r2 = run(drift.cli, ['patch']);
  eq(r2.status, 2, 'exit 2');
  includes(r2.err, '❌', 'mensaje de error');
  eq(pkgVersion(drift.dir), '1.0.0', 'sin escrituras');

  const roto = sandbox('1.0.0');
  write(join(roto.dir, 'init.ps1'), '\uFEFF# sin constante\r\nWrite-Host hola\r\n');
  const r3 = run(roto.cli, ['patch']);
  eq(r3.status, 3, 'exit 3');
  eq(pkgVersion(roto.dir), '1.0.0', 'sin escrituras');
});

test('CLI --set idempotente: no reescribe y sale 0', () => {
  const s = sandbox('1.0.0');
  const sube = run(s.cli, ['--set', '1.0.2']);
  eq(sube.status, 0, '--set aplicado');
  eq(pkgVersion(s.dir), '1.0.2', 'versión escrita');
  const antes = read(s.dir, 'init.mjs');
  const otraVez = run(s.cli, ['--set', '1.0.2']);
  eq(otraVez.status, 0, 'repetir --set sale 0');
  includes(otraVez.out, 'ya está en 1.0.2', 'lo dice explícitamente');
  eq(read(s.dir, 'init.mjs'), antes, 'no reescribe');
});

test('CLI tras un bump consistente: otro patch planifica la siguiente (exit 0, no idempotente por sí solo)', () => {
  const s = sandbox('1.0.0');
  eq(run(s.cli, ['patch']).status, 0, 'primer bump ok');
  const r = run(s.cli, ['patch', '--dry-run']);
  // Tras un bump los 6 ficheros están alineados, así que NO hay drift: el plan
  // del siguiente patch es legítimo (1.0.1 → 1.0.2). El exit 2 solo aparece con
  // drift preexistente, no por repetir el comando.
  eq(r.status, 0, 'dry-run en estado consistente → 0');
  includes(r.out, '1.0.1 → 1.0.2', 'planifica el patch siguiente');
  eq(pkgVersion(s.dir), '1.0.1', 'el dry-run no escribe');
});

test('CLI errores de uso: sin args, flag desconocido, kind+--set y --set inválido → 1', () => {
  const s = sandbox('1.0.0');
  for (const args of [[], ['--wat'], ['patch', '--set', '2.0.0'], ['--set'], ['--set', 'x.y.z'], ['patch', 'minor']]) {
    eq(run(s.cli, args).status, 1, `args ${JSON.stringify(args)} → 1`);
  }
  eq(pkgVersion(s.dir), '1.0.0', 'ningún error de uso escribe');
});

test('CLI --help: exit 0 y uso por stdout', () => {
  const s = sandbox('1.0.0');
  const r = run(s.cli, ['--help']);
  eq(r.status, 0, '--help exit 0');
  includes(r.out, 'version-bump.mjs <patch|minor|major>', 'imprime el uso');
});

await runAll();
