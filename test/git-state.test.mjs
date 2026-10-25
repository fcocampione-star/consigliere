#!/usr/bin/env node
/**
 * test/git-state.test.mjs — `.opencode/scripts/git-state.mjs`: trámites de rama
 * de solo lectura con argv CERRADO (allowlist exacta de bash del advisor).
 *
 * Cubre: los 7 subcomandos contra un repo temporal real, recorte a 40 líneas,
 * rechazo de argumentos libres / flags / compuestos ANTES de spawnear, códigos
 * de uso (1), dependencia (3) y fallo de git (5), aviso de "sin fetch" en
 * `ahead-behind`, `--help` y paridad byte a byte raíz↔templates.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { suite, test, eq, assert, includes, match, tmpdir, cleanup, runAll } from './harness.mjs';
import {
  MAX_LINES,
  NO_FETCH_NOTE,
  SUBCOMMAND_NAMES,
  auditArgv,
  isSafeUserElement,
  trimOutput,
} from '../.opencode/scripts/git-state.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(REPO_ROOT, '.opencode', 'scripts', 'git-state.mjs');
const TEMPLATE_SCRIPT = join(REPO_ROOT, 'templates', '.opencode', 'scripts', 'git-state.mjs');

const TEMPS = [];
process.on('exit', () => cleanup(TEMPS));

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function cli(args, { cwd, env } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    env: { ...process.env, ...(env || {}) },
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Repo temporal con un commit; devuelve { dir, branch }. */
function newRepo() {
  const dir = tmpdir('advisor-git-state');
  TEMPS.push(dir);
  const init = git(dir, ['init', '-q']);
  assert(init.status === 0, `git init: ${init.err}`);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  // El test de recorte depende de que status liste cada archivo sin seguimiento:
  // un `status.showUntrackedFiles=no` global del runner lo vaciaría.
  git(dir, ['config', 'status.showUntrackedFiles', 'normal']);
  writeFileSync(join(dir, 'a.txt'), 'hola\n');
  git(dir, ['add', 'a.txt']);
  const commit = git(dir, ['commit', '-q', '-m', 'primer commit']);
  assert(commit.status === 0, `git commit: ${commit.err}`);
  return { dir, branch: git(dir, ['symbolic-ref', '--short', 'HEAD']).out };
}

// ── Suite 1: contrato puro (sin spawn) ──────────────────────────────────────
suite('git-state · contrato puro');

test('tabla cerrada: exactamente los 7 subcomandos de solo lectura', () => {
  eq(SUBCOMMAND_NAMES, ['status', 'log', 'head', 'branch', 'diff-stat', 'ahead-behind', 'remote'], 'subcomandos cerrados');
});

test('isSafeUserElement: rechaza flags y metacaracteres; acepta refs/rutas normales', () => {
  for (const bad of ['--exec', '--output=x', '--upload-pack=touch /tmp/x', 'a;rm -rf x', 'a && b', '$(id)', 'a|b', 'a`b`', '', 'a b']) {
    eq(isSafeUserElement(bad), false, `rechazado: ${JSON.stringify(bad)}`);
  }
  for (const good of ['HEAD', '@{u}...HEAD', 'origin/main', 'feature/x-1', 'v1.2.3', 'a..b']) {
    eq(isSafeUserElement(good), true, `aceptado: ${JSON.stringify(good)}`);
  }
});

test('auditArgv: los argv fijos de la tabla son seguros y un token suelto no', () => {
  eq(auditArgv(['status', '--short', '--branch']), null, 'argv fijo de status ok');
  eq(auditArgv(['rev-list', '--left-right', '--count', '@{u}...HEAD']), null, 'argv fijo de ahead-behind ok');
  eq(auditArgv(['status', '--output=/tmp/x']), '--output=/tmp/x', 'flag no literal detectado');
  eq(auditArgv(['status', 'a;b']), 'a;b', 'metacarácter detectado');
});

test(`trimOutput: corta en ${MAX_LINES} líneas con sufijo y no toca salidas cortas`, () => {
  const lines = Array.from({ length: MAX_LINES + 5 }, (_, i) => `l${i + 1}`);
  const corto = trimOutput(lines.slice(0, MAX_LINES).join('\n'));
  eq(corto.split('\n').length, MAX_LINES, 'salida corta intacta');
  const largo = trimOutput(lines.join('\n')).split('\n');
  eq(largo.length, MAX_LINES + 1, 'tope + sufijo');
  eq(largo[0], 'l1', 'conserva el principio');
  eq(largo[MAX_LINES], '… (truncated)', 'sufijo de recorte');
  eq(trimOutput('   \n\n'), '', 'salida vacía → cadena vacía');
});

// ── Suite 2: e2e contra repos temporales ────────────────────────────────────
suite('git-state · e2e CLI');

test('status: exit 0, rama actual y sin recorte cuando hay pocas líneas', () => {
  const { dir, branch } = newRepo();
  const r = cli(['status'], { cwd: dir });
  eq(r.status, 0, `status sale 0 (stderr: ${r.err.trim()})`);
  includes(r.out, '## ', 'cabecera de status --branch');
  includes(r.out, branch, 'nombra la rama actual');
  assert(!r.out.includes('truncated'), 'una salida corta no se recorta');
});

test('status: 60 archivos sin seguimiento → recorta a 40 líneas + sufijo', () => {
  const { dir } = newRepo();
  for (let i = 1; i <= 60; i++) writeFileSync(join(dir, `nuevo-${i}.txt`), 'x\n');
  const r = cli(['status'], { cwd: dir });
  eq(r.status, 0, 'status sale 0');
  const lines = r.out.replace(/\s+$/, '').split('\n');
  eq(lines.length, MAX_LINES + 1, `tope ${MAX_LINES} + sufijo`);
  eq(lines[MAX_LINES], '… (truncated)', 'última línea = sufijo');
  includes(r.out, '?? nuevo-1.txt', 'conserva el principio de la salida');
  assert(!r.out.includes('nuevo-60.txt'), 'el final recortado no llega');
});

test('log / head / branch / diff-stat / remote: exit 0 sobre el repo temporal', () => {
  const { dir, branch } = newRepo();
  eq(cli(['log'], { cwd: dir }).status, 0, 'log sale 0');
  includes(cli(['log'], { cwd: dir }).out, 'primer commit', 'log --oneline muestra el commit');
  const head = cli(['head'], { cwd: dir });
  eq(head.status, 0, 'head sale 0');
  match(head.out.trim(), /^[0-9a-f]{7,}$/, 'HEAD abreviado');
  eq(cli(['branch'], { cwd: dir }).out.trim(), branch, 'branch --show-current');
  eq(cli(['diff-stat'], { cwd: dir }).status, 0, 'diff-stat sale 0 (sin cambios: salida vacía)');
  eq(cli(['remote'], { cwd: dir }).status, 0, 'remote sale 0 (sin remotos)');
});

test('ahead-behind: 0 0 con upstream y aviso explícito de que NO hace fetch', () => {
  const origin = tmpdir('advisor-git-origin');
  TEMPS.push(origin);
  const bare = git(origin, ['init', '-q', '--bare']);
  assert(bare.status === 0, `git init --bare: ${bare.err}`);
  const { dir, branch } = newRepo();
  git(dir, ['remote', 'add', 'origin', origin.replace(/\\/g, '/')]);
  const push = git(dir, ['push', '-q', '-u', 'origin', branch]);
  eq(push.status, 0, `git push -u: ${push.err}`);
  const r = cli(['ahead-behind'], { cwd: dir });
  eq(r.status, 0, `ahead-behind sale 0 (stderr: ${r.err.trim()})`);
  match(r.out, /^0\t0\n/, 'izquierda=derecha=0 (sincronizado), separado por TAB');
  includes(r.out, NO_FETCH_NOTE, 'declara que no hace fetch');
  includes(r.out, 'sin fetch', 'texto de aviso presente');
});

test('códigos: 1 por argv inválido (sin spawnear), 3 sin git, 5 git falla', () => {
  const { dir } = newRepo();
  for (const bad of [['status', ';touch PWNED'], ['status', '&& rm -rf x'], ['status', '--exec=evil'], ['status', '--output=/tmp/x'], ['status', 'extra']]) {
    const r = cli(bad, { cwd: dir });
    eq(r.status, 1, `argv inválido sale 1: ${JSON.stringify(bad)}`);
    assert(!existsSync(join(dir, 'PWNED')) && !existsSync('/tmp/x'), 'nada ejecutado / ningún archivo escrito');
  }
  for (const sub of ['run', 'push', 'fetch', 'STATUS']) {
    eq(cli([sub], { cwd: dir }).status, 1, `subcomando fuera de la tabla sale 1: ${sub}`);
  }
  eq(cli(['status'], { cwd: dir, env: { ADVISOR_GIT: join(dir, 'git-inexistente') } }).status, 3, 'git ausente sale 3');
  const falla = cli(['ahead-behind'], { cwd: dir });
  eq(falla.status, 5, 'sin upstream → git rev-list falla → exit 5');
  match(falla.err, /upstream|no such|does not/i, 'propaga el error de git');
});

test('argv con ";" jamás llega a git: binario falso y marcador ausente', () => {
  if (process.platform === 'win32') return; // el fake es un .sh posix
  const { dir } = newRepo();
  const marker = join(dir, 'spawned.marker');
  const fake = join(dir, 'fake-git.sh');
  writeFileSync(fake, `#!/bin/sh\necho si > "${marker}"\nexit 0\n`);
  chmodSync(fake, 0o755);
  const r = cli(['status', ';touch PWNED'], { cwd: dir, env: { ADVISOR_GIT: fake } });
  eq(r.status, 1, 'argv inválido sale 1');
  assert(!existsSync(marker), 'git no se ejecutó (ni el binario falso)');
  assert(!existsSync(join(dir, 'PWNED')), 'el compuesto no se ejecutó');
  // Control positivo: con un subcomando válido SÍ se ejecuta el binario resuelto.
  eq(cli(['status'], { cwd: dir, env: { ADVISOR_GIT: fake } }).status, 0, 'subcomando válido ejecuta el binario');
  assert(existsSync(marker), 'el control positivo demuestra que el marcador funciona');
});

test('--help / -h: uso por stdout y exit 0 (los 7 subcomandos listados)', () => {
  for (const flag of ['--help', '-h']) {
    const r = cli([flag]);
    eq(r.status, 0, `${flag} sale 0`);
    includes(r.out, 'Uso:', 'imprime uso');
    for (const sub of SUBCOMMAND_NAMES) includes(r.out, sub, `lista ${sub}`);
  }
});

test('paridad byte a byte raíz ↔ templates', () => {
  eq(readFileSync(TEMPLATE_SCRIPT, 'utf8'), readFileSync(SCRIPT, 'utf8'), 'templates/.opencode/scripts/git-state.mjs == raíz');
});

await runAll();
