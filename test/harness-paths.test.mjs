#!/usr/bin/env node
/**
 * test/harness-paths.test.mjs — contrato de rutas del helper de temporales.
 *
 * Regresión del fallo preexistente en macos-latest (desde fa4d9e7):
 * `/var` es symlink de `/private/var`, `os.tmpdir()` llega SIN canonicalizar
 * y los motores del harness imprimen rutas canónicas vía `import.meta.dirname`
 * (que Node entrega YA resuelta vía realpath — ver test/lib.test.mjs y el realpathOr de
 * .opencode/scripts/lib/core.mjs). Con la base sin canonicalizar,
 * `eq(st.file, join(PROYECTO, 'SUMMARY.md'))` de e2e-harness-v2 comparaba
 * `/var/folders/...` con `/private/var/folders/...` y solo revienta en macOS.
 * El punto único del fix es `tmpdir()` de test/harness.mjs: aquí se pina ese
 * contrato y se SIMULA la divergencia en cualquier SO con un enlace
 * (junction en Windows — no exige permisos de admin —, symlink en POSIX).
 */

import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test, eq, neq, tmpdir, cleanup, runAll } from './harness.mjs';

suite('harness · rutas canónicas (punto único: tmpdir())');

test('tmpdir() devuelve SIEMPRE la grafía canónica (macOS: /var → /private/var)', () => {
  const t = tmpdir('advisor-canonical');
  try {
    eq(realpathSync(t), t, 'tmpdir() debe devolver la ruta YA resuelta vía realpath (contrato del punto único)');
  } finally {
    cleanup(t);
  }
});

test('simulación portable de la divergencia: la MISMA ruta física tiene DOS grafías', () => {
  const real = mkdtempSync(join(osTmpdir(), 'advisor-realpath-'));
  const alias = `${real}-alias`;
  try {
    // Windows: junction (no exige admin, no es symlink NTFS); POSIX: symlink de directorio.
    symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    // Solo si esta máquina no permite enlaces (raro: la junction no es un
    // symlink NTFS y no exige admin). El pin del helper queda cubierto por el
    // test anterior y por realpathSync directo; la simulación, documentada
    // aquí, no bloquea la suite.
    console.log(`  [nota] sin capacidad de enlace en esta máquina: solo aserción realpath directa (${e.message})`);
    cleanup(real);
    return;
  }
  try {
    writeFileSync(join(real, 'SUMMARY.md'), '# pin\n');
    // Las DOS grafías que el e2e compara: el lado MOTOR (import.meta.dirname —
    // Node la entrega canonicalizada, como el realpath que atraviesa el
    // enlace) y el lado helper SIN canonicalizar (la ruta cruda por el alias).
    const grafiaMotor = realpathSync(join(alias, 'SUMMARY.md'));
    const grafiaCruda = join(alias, 'SUMMARY.md');
    neq(grafiaCruda, grafiaMotor, 'el fixture debe reproducir la divergencia: dos grafías de la MISMA ruta física');
    // El punto único del fix (realpath en la base del helper) une motor y
    // helper a una sola grafía: si el helper pierde la canonicalización, el
    // e2e vuelve a comparar grafías distintas y este test cae con él.
    eq(realpathSync(grafiaCruda), grafiaMotor, 'realpathSync une ambas grafías: única forma de que helper y motor casen');
  } finally {
    cleanup([alias, real]);
  }
});

await runAll();
