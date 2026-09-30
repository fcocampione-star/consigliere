#!/usr/bin/env node
/**
 * test/doctor.test.mjs — suite de caracterizacion de
 * `.opencode/scripts/doctor.mjs` ejecutado como PROCESO HIJO.
 *
 * Por que hijo y no import: doctor.mjs no exporta nada y ejecuta todo en el
 * cuerpo del modulo (checks + `process.exit` en la linea 155), ademas resuelve
 * ROOT desde su propia ubicacion (`import.meta.dirname`, linea 13), asi que no
 * hay forma de apuntarlo a un arbol temporal. Se ejecuta entonces el binario
 * real contra el repo real con `spawnSync` y se afirman solo propiedades
 * estables:
 *  - el exit code cumple el contrato documentado (0 ok, 1 warnings, 2 errors,
 *    linea 5) y depende SOLO de los estados de error y warning;
 *  - `--json` emite JSON parseable con la forma `{ checks: [{name, status,
 *    detail, fix}] }` (linea 148) y cada status pertenece al vocabulario;
 *  - el modo texto imprime la tabla markdown documentada (lineas 150-153) con
 *    una fila por check.
 *
 * NO se afirma el numero de checks (es variable por diseno: hay bloques
 * condicionales, secciones informativas y entradas vivas) ni los nombres
 * individuales salvo dos anclas estables.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, assert, eq, neq, match, includes, runAll } from './harness.mjs';

const REPO = join(import.meta.dirname, '..');
const DOCTOR = join(REPO, '.opencode', 'scripts', 'doctor.mjs');
const MAX_BUFFER = 16 * 1024 * 1024;

// Vocabulario de estados documentado en doctor.mjs (se escribe con escapes para
// que el archivo no dependa de la codificacion del editor ni contenga emojis).
const S_OK = '\u2705';
const S_WARN = '\u26a0\ufe0f';
const S_ERR = '\u274c';
const S_INFO = '\u2139\ufe0f';
const STATUS = [S_OK, S_WARN, S_ERR, S_INFO];
const CLAVES_CHECK = ['detail', 'fix', 'name', 'status'];

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Corre el doctor real como hijo y devuelve codigo + salida separada.
function run(args = []) {
  const res = spawnSync(process.execPath, [DOCTOR, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  assert(!res.error, `spawn de doctor.mjs fallo: ${res.error && res.error.message}`);
  assert(res.signal === null, `doctor.mjs no deberia morir por senal (fue ${res.signal})`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

function checksDe(out) {
  const parsed = JSON.parse(out);
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'la raiz del JSON debe ser un objeto');
  return parsed;
}

// Filas de la tabla markdown: empiezan por "| " y contienen un status. Asi la
// cabecera ("ADVISOR doctor - ..."), la linea de encabezado y el separador,
// que no llevan status, quedan fuera.
function filas(out) {
  return out.split(/\r?\n/).filter((l) => l.startsWith('| ') && STATUS.some((s) => l.includes(s)));
}

// ── Contrato de exit code ────────────────────────────────────────────────────

suite('doctor exit code');

test('sin argumentos imprime la cabecera y la tabla markdown documentada', () => {
  const r = run();
  match(r.out, /^ADVISOR doctor \u2014 /m, 'primera linea: cabecera ADVISOR doctor');
  includes(r.out, '| Check | Estado | Detalle | Fix |', 'cabecera de la tabla');
  includes(r.out, '|-------|--------|---------|-----|', 'separador de la tabla');
  eq(r.err, '', 'el modo texto no escribe en stderr');
});

test('el exit code es uno de los tres documentados: 0 ok, 1 warnings, 2 errors', () => {
  const r = run();
  assert([0, 1, 2].includes(r.code), `exit code fuera de contrato: ${r.code}`);
});

test('el exit code coincide con el derivado de los estados de sus propios checks', () => {
  const texto = run();
  const json = run(['--json']);
  const checks = checksDe(json.out).checks;
  const esperado = checks.some((c) => c.status === S_ERR) ? 2 : checks.some((c) => c.status === S_WARN) ? 1 : 0;
  eq(texto.code, esperado, 'el modo texto devuelve el codigo del contrato');
  eq(json.code, esperado, 'el modo --json devuelve el mismo codigo que el modo texto');
});

test('los checks informativos no degradan el codigo de salida', () => {
  const json = run(['--json']);
  const checks = checksDe(json.out).checks;
  const info = checks.filter((c) => c.status === S_INFO);
  const hasWarn = checks.some((c) => c.status === S_WARN);
  const hasErr = checks.some((c) => c.status === S_ERR);
  if (info.length && !hasWarn && !hasErr) {
    eq(json.code, 0, 'solo having checks informativos deja el harness en 0');
  } else {
    const esperado = hasErr ? 2 : hasWarn ? 1 : 0;
    eq(json.code, esperado, 'los ℹ️ no cuentan como warning ni como error');
  }
  for (const c of info) neq(c.status, S_WARN, 'un informativo no es un warning');
});

test('harness sano del repo real: ningun check cae en estado de error', () => {
  const r = run();
  const checks = checksDe(run(['--json']).out).checks;
  const errores = checks.filter((c) => c.status === S_ERR).map((c) => c.name);
  eq(errores, [], `checks en error: ${errores.join(', ')}`);
  neq(r.code, 2, 'con ningun check en error el exit code nunca es 2');
});

// ── Modo --json ──────────────────────────────────────────────────────────────

suite('doctor --json: forma documentada');

test('--json emite JSON parseable con la forma { checks: [...] }', () => {
  const r = run(['--json']);
  const parsed = checksDe(r.out);
  eq(Object.keys(parsed), ['checks'], 'la unica clave de primer nivel es checks');
  assert(Array.isArray(parsed.checks), 'checks debe ser un array');
  assert(parsed.checks.length > 0, 'un harness sano reporta al menos un check');
  assert(!r.out.includes('| Check |'), 'el modo --json no imprime la tabla markdown');
});

test('cada check lleva exactamente name, status, detail y fix con los tipos correctos', () => {
  const checks = checksDe(run(['--json']).out).checks;
  for (const c of checks) {
    eq(Object.keys(c).sort(), CLAVES_CHECK, `claves del check ${c.name}`);
    assert(typeof c.name === 'string' && c.name.length > 0, 'name debe ser un string no vacio');
    assert(typeof c.detail === 'string' && c.detail.length > 0, `detail no vacio en ${c.name}`);
    assert(typeof c.fix === 'string', `fix debe ser un string en ${c.name}`);
  }
});

test('todo status pertenece al vocabulario documentado de cuatro estados', () => {
  eq(STATUS.length, 4, 'el vocabulario tiene cuatro estados');
  const checks = checksDe(run(['--json']).out).checks;
  for (const c of checks) {
    assert(STATUS.includes(c.status), `status fuera de vocabulario en ${c.name}: ${JSON.stringify(c.status)}`);
  }
  const vistos = [...new Set(checks.map((c) => c.status))];
  for (const s of vistos) assert(STATUS.includes(s), `estado repetido fuera de vocabulario: ${s}`);
});

test('los nombres de check son unicos (una fila por check, sin duplicados)', () => {
  const checks = checksDe(run(['--json']).out).checks;
  const nombres = checks.map((c) => c.name);
  eq(nombres.length, new Set(nombres).size, 'nombres duplicados');
});

test('las dos anclas estables del harness estan presentes', () => {
  const checks = checksDe(run(['--json']).out).checks;
  const names = checks.map((c) => c.name);
  assert(names.includes('opencode.json'), 'debe existir el check de opencode.json');
  assert(names.some((n) => n.startsWith('script ')), 'debe existir al menos un check de script');
  for (const c of checks.filter((x) => x.name.startsWith('script '))) {
    assert(existsSync(join(REPO, '.opencode', 'scripts', c.name.replace(/^script /, ''))), `el script del check ${c.name} deberia existir`);
  }
});

test('los checks de memoria citan un conteo de lineas en su detail', () => {
  const checks = checksDe(run(['--json']).out).checks;
  for (const c of checks.filter((x) => /líneas/.test(x.detail))) {
    match(c.detail, /\d+ líneas/, `el detail de ${c.name} deberia traer el conteo`);
  }
});

// ── Modo texto ───────────────────────────────────────────────────────────────

suite('doctor modo texto: tabla');

test('la tabla tiene una fila por check y cada fila usa un status del vocabulario', () => {
  const r = run();
  const checks = checksDe(run(['--json']).out).checks;
  const rows = filas(r.out);
  eq(rows.length, checks.length, 'una fila por check');
  for (const row of rows) {
    match(row, new RegExp('^\\| .+ \\| (?:' + STATUS.map(esc).join('|') + ') \\|'), `fila con status conocido: ${row.slice(0, 60)}`);
  }
});

test('cada fila lleva las cuatro columnas Check, Estado, Detalle y Fix', () => {
  const r = run();
  const checks = checksDe(run(['--json']).out).checks;
  for (const [i, row] of filas(r.out).entries()) {
    const celdas = row.split('|').slice(1, -1).map((c) => c.trim());
    eq(celdas.length, 4, `cuatro celdas en la fila ${i + 1}: ${row.slice(0, 60)}`);
    eq(celdas[0], checks[i].name, `el nombre de la fila ${i + 1} coincide con el JSON`);
    eq(celdas[1], checks[i].status, `el estado de la fila ${i + 1} coincide con el JSON`);
  }
});

test('el modo texto no emite JSON', () => {
  const r = run();
  assert(!r.out.trimStart().startsWith('{'), 'el modo texto no arranca con una llave JSON');
});

// ── Robustez de la invocacion ────────────────────────────────────────────────

suite('doctor invocacion');

test('un flag desconocido no activa el modo JSON (solo --json lo hace)', () => {
  const texto = run();
  const otro = run(['--verbose']);
  eq(otro.code, texto.code, 'mismo codigo de salida');
  eq(otro.out, texto.out, 'misma salida que sin flags');
  assert(otro.out.includes('| Check | Estado | Detalle | Fix |'), 'sigue siendo la tabla markdown');
});

test('doctor es de solo lectura: dos corridas seguidas dan salida identica', () => {
  const a = run(['--json']);
  const b = run(['--json']);
  eq(b.out, a.out, 'el JSON es estable entre corridas');
  eq(b.code, a.code, 'el exit code es estable entre corridas');
});

test('el modo texto y el modo --json coinciden en el numero de checks', () => {
  const texto = run();
  const checks = checksDe(run(['--json']).out).checks;
  eq(filas(texto.out).length, checks.length, 'mismo numero de checks en ambos modos');
});

await runAll();
