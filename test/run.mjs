#!/usr/bin/env node
/**
 * test/run.mjs — agregador de la suite de tests del repo.
 *
 * Cada `test/*.test.mjs` se ejecuta en un PROCESO HIJO separado (spawnSync):
 * así un test que llame a `process.exit()` (runAll), una variable de entorno
 * filtrada o un módulo cacheado no puede contaminar a los demás, y un crash
 * aislado no se come el resto de la corrida.
 *
 * Contrato:
 *  - Descubre `test/*.test.mjs` (excluyéndose a sí mismo y a los módulos de
 *    soporte `harness.mjs` / `fixtures.mjs`), ordenados para runs deterministas.
 *  - Timeout por hijo: 180 s. `maxBuffer`: 16 MiB.
 *  - Éxito → una línea compacta por archivo. Fallo → stdout y stderr del hijo
 *    VERBATIM, más su código de salida (o el flag de timeout).
 *  - Exit 1 si algún hijo falló o expiró; 0 en caso contrario (incluido el caso
 *    "todavía no hay archivos de test": imprime un aviso claro y sale 0).
 *
 * Uso: node test/run.mjs
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const SELF = 'run.mjs';
const SUPPORT = new Set([SELF, 'harness.mjs', 'fixtures.mjs']);
const TIMEOUT_MS = 180000;
const MAX_BUFFER = 16 * 1024 * 1024;
const OK = '\u2713';
const KO = '\u274C';

function discover() {
  let entries;
  try {
    entries = readdirSync(DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`test/run.mjs: no se pudo leer ${DIR}: ${e.message}`);
    return null;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.test.mjs') && !SUPPORT.has(e.name))
    .map((e) => e.name)
    .sort(); // orden lexicográfico estable → corridas reproducibles
}

const files = discover();
if (files === null) process.exit(1);

console.log(`test/run.mjs — ${files.length} archivo(s) de test en test/`);

if (files.length === 0) {
  console.log('  Sin tests que ejecutar: no hay test/*.test.mjs todavía.');
  console.log('  Crea uno (p.ej. test/memory-rotate.test.mjs) que termine con `await runAll();`.');
  console.log('-'.repeat(60));
  console.log('TOTAL: 0/0 archivos · 0 ms');
  process.exit(0);
}

let passed = 0;
let failed = 0;
const startedAt = Date.now();

for (const name of files) {
  const abs = join(DIR, name);
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [abs], { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const ms = Date.now() - t0;
  const ok = !res.error && res.status === 0 && !res.signal;
  if (ok) {
    passed++;
    console.log(`  ${OK} ${name} (${ms} ms)`);
    continue;
  }
  failed++;
  const how = res.error ? `error: ${res.error.message}` : res.signal ? `signal: ${res.signal}` : `exit ${res.status}`;
  const label = res.error && res.error.code === 'ETIMEDOUT' ? ' [TIMEOUT]' : '';
  console.log(`  ${KO} ${name} (${ms} ms)${label} — ${how}`);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stdout.write(res.stderr);
  if (!res.stdout && !res.stderr) console.log('  (el hijo no produjo salida)');
}

const totalMs = Date.now() - startedAt;
console.log('-'.repeat(60));
console.log(`archivos: ${passed}/${files.length} ${failed ? KO : OK} · duracion total ${totalMs} ms`);
process.exit(failed ? 1 : 0);