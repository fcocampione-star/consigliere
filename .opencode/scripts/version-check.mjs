#!/usr/bin/env node
/**
 * version-check.mjs — single-source de la versión del harness.
 * Uso: node .opencode/scripts/version-check.mjs
 * Exit: 0 = la versión de package.json aparece en los 3 instaladores, 1 = drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

const TARGETS = [
  ['init.mjs', /const VERSION = '([^']+)'/],
  ['init.sh', /^VERSION="([^"]+)"/m],
  ['init.ps1', /^\$HARNESS_VERSION = "([^"]+)"/m],
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const expected = pkg.version;
const drift = [];

for (const [rel, re] of TARGETS) {
  const found = readFileSync(join(ROOT, rel), 'utf8').match(re);
  if (!found) drift.push(`${rel}: no se encontró la constante de versión`);
  else if (found[1] !== expected) drift.push(`${rel}: declara v${found[1]} (esperado v${expected})`);
}

if (drift.length) {
  console.error(`❌ version desalineada respecto a package.json (${expected}):`);
  for (const d of drift) console.error(`   - ${d}`);
  process.exit(1);
}

console.log(`✅ version consistente: ${expected}`);
