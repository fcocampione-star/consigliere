/**
 * test/harness.mjs — micro-framework de tests del repo.
 *
 * Contrato:
 *  - Un archivo `test/*.test.mjs` importa lo que necesite de aquí, registra
 *    casos con `suite()`/`test()` y termina con `await runAll();` a nivel de
 *    módulo (toplevel await).
 *  - `runAll()` ejecuta los tests en ORDEN de registro, imprime el reporte y
 *    hace `process.exit(1)` si algún caso falló (0 si todo pasó).
 *  - Ninguna excepción escapa de un caso: `fn()` (sync o async) se envuelve en
 *    try/catch; el fallo se cuenta y la corrida continúa.
 *  - CERO dependencias y CERO conocimiento del repo: solo imports `node:`.
 *
 * Uso típico:
 *   import { suite, test, eq, runAll } from './harness.mjs';
 *   suite('memory-lock');
 *   test('adquiere y libera', () => { eq(1, 1, 'uno es uno'); });
 *   await runAll();
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';

// Glifos de salida (U+2713 ok / U+274C fallo). Solo output: nunca en identifiers.
const OK = '\u2713';
const KO = '\u274C';
const TRUNC = 400; // caracteres por valor en el mensaje de un assert fallido

// AssertionError local: el mismo nombre que usa node:assert para que el reporte
// sea uniforme (`-> AssertionError: <msg>`), sin depender de la versión de Node.
class AssertionError extends Error {
  constructor(message) {
    super(String(message));
    this.name = 'AssertionError';
  }
}

let currentSuite = '(sin suite)';
const tests = [];

export function suite(name) {
  currentSuite = String(name);
}

export function test(name, fn) {
  tests.push({ suite: currentSuite, name: String(name), fn });
}

// ── Comparación estructural (tolerante al orden de claves) ───────────────────
// Canonicaliza recursivamente: objetos → claves ordenadas; arrays → orden intacto.
// Se compara la "huella" (JSON de lo canonicalizado), no la identidad.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return { __date: value.toISOString() };
  if (value instanceof RegExp) return { __regexp: String(value) };
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

function fingerprint(value) {
  let s;
  try { s = JSON.stringify(canonical(value)); } catch { return String(value); }
  return s === undefined ? String(value) : s;
}

function show(value) {
  let s;
  try { s = JSON.stringify(canonical(value), null, 2); } catch { s = String(value); }
  return s === undefined ? String(value) : s;
}

function trunc(s, n = TRUNC) {
  const str = String(s);
  return str.length <= n ? str : `${str.slice(0, n)}... (${str.length} chars)`;
}

function fail(msg) {
  throw new AssertionError(msg);
}

// ── Asserts ────────────────────────────────────────────────────────────────
export function assert(cond, msg) {
  if (!cond) fail(msg);
}

export function eq(actual, expected, msg) {
  if (fingerprint(actual) === fingerprint(expected)) return;
  fail(`${msg || 'eq'} — esperado: ${trunc(show(expected))} | obtenido: ${trunc(show(actual))}`);
}

export function neq(actual, unexpected, msg) {
  if (fingerprint(actual) !== fingerprint(unexpected)) return;
  fail(`${msg || 'neq'} — no debía ser: ${trunc(show(unexpected))}`);
}

export function match(value, regex, msg) {
  regex.lastIndex = 0; // un /g compartido no debe alternar resultados entre tests
  if (regex.test(String(value))) return;
  fail(`${msg || 'match'} — ${trunc(String(value))} no casa con ${regex}`);
}

export function includes(haystack, needle, msg) {
  const ok = typeof haystack === 'string'
    ? haystack.includes(String(needle))
    : (Array.isArray(haystack) && haystack.includes(needle));
  if (ok) return;
  fail(`${msg || 'includes'} — ${trunc(show(haystack))} no contiene ${trunc(show(needle))}`);
}

// Devuelve el error lanzado; falla el test si la fn no lanzó nada.
export function throws(fn, msg) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  fail(`${msg || 'throws'} — se esperaba una excepción y no se lanzó ninguna`);
}

// Igual que throws() pero tolera fn async (o sync) y devuelve el rechazo.
export async function throwsAsync(fn, msg) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  fail(`${msg || 'throwsAsync'} — se esperaba un rechazo y la promesa se resolvió`);
}

// ── Utilidades de disco ────────────────────────────────────────────────────
export function tmpdir(prefix) {
  return mkdtempSync(join(osTmpdir(), `${prefix}-`));
}

export function cleanup(paths) {
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    if (!p) continue;
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── Corredor ───────────────────────────────────────────────────────────────
export async function runAll() {
  const tally = new Map(); // suite -> { total, ok, failed }
  let lastSuite = null;
  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    if (t.suite !== lastSuite) {
      console.log(`## ${t.suite}`);
      lastSuite = t.suite;
    }
    let error = null;
    try {
      if (typeof t.fn !== 'function') throw new TypeError('test(): el segundo argumento debe ser una función');
      await t.fn(); // sync o async; el return se descarta
    } catch (e) {
      error = e;
    }
    const st = tally.get(t.suite) || { total: 0, ok: 0, failed: 0 };
    st.total++;
    if (error) {
      failed++;
      st.failed++;
      console.log(`  ${KO} ${t.suite} - ${t.name}`);
      const name = (error && error.name) || 'Error';
      const msg = (error && error.message) || String(error);
      console.log(`  -> ${name}: ${String(msg).replace(/\s+$/, '')}`);
    } else {
      passed++;
      st.ok++;
      console.log(`  ${OK} ${t.suite} - ${t.name}`);
    }
    tally.set(t.suite, st);
  }

  console.log('-'.repeat(60));
  for (const [name, st] of tally) console.log(`${name}: ${st.ok}/${st.total} ${st.failed ? KO : OK}`);
  console.log(`TOTAL: ${passed}/${tests.length} ${failed ? KO : OK}${failed ? ` (${failed} fallo(s))` : ''}`);

  // Vacía stdout antes de salir: en pipes macOS la escritura es asíncrona y
  // process.exit() recortaría el reporte.
  await new Promise((r) => process.stdout.write('', () => r()));
  process.exit(failed ? 1 : 0);
}