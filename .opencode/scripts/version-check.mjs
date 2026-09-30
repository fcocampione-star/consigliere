#!/usr/bin/env node
/**
 * version-check.mjs — single-source de la versión del harness.
 * Uso: node .opencode/scripts/version-check.mjs
 * Exit: 0 = la versión de package.json aparece en los 3 ficheros del
 * instalador que la declaran (init.mjs, que es la implementación, + los dos
 * lanzadores con constante propia init.sh/init.ps1) y en las 2 SKILL.md de
 * _project-docs (raíz + plantilla), 1 = drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

// La versión NO puede vivir solo en `package.json`: hay una segunda fuente
// documental que la repite y que se lee en cada sesión (`_project-docs/SKILL.md`,
// una por copia: la del repo y la que se instala). Las dos se comprueban porque
// son las dos que se distributen; una de las dos desalineada es drift real.
const SKILL_REL = '.opencode/skills/_project-docs/SKILL.md';
// La versión aparece pegada a la invocación recomendada (`vX.Y.Z via npx
// advisor-harness@latest`): el ancla es esa forma y no un `X.Y.Z` suelto, para no
// capturar otras versiones del documento (p. ej. `metadata.version`, que es la
// versión de la skill, no la del harness).
const SKILL_VERSION_RE = /\bv(\d+\.\d+\.\d+)\b(?=[^|\n]*\bvia npx advisor-harness@latest)/;

const TARGETS = [
  ['init.mjs', /const VERSION = '([^']+)'/],
  ['init.sh', /^VERSION="([^"]+)"/m],
  ['init.ps1', /^\$HARNESS_VERSION = "([^"]+)"/m],
  [SKILL_REL, SKILL_VERSION_RE],
  [join('templates', SKILL_REL), SKILL_VERSION_RE],
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const expected = pkg.version;
const drift = [];

for (const [rel, re] of TARGETS) {
  let found = null;
  try { found = readFileSync(join(ROOT, rel), 'utf8').match(re); }
  catch (e) { drift.push(`${rel}: no se pudo leer (${e.code || e.message})`); continue; }
  if (!found) drift.push(`${rel}: no se encontró la constante de versión`);
  else if (found[1] !== expected) drift.push(`${rel}: declara v${found[1]} (esperado v${expected})`);
}

if (drift.length) {
  console.error(`❌ version desalineada respecto a package.json (${expected}):`);
  for (const d of drift) console.error(`   - ${d}`);
  process.exit(1);
}

console.log(`✅ version consistente: ${expected} (${TARGETS.length} ficheros: init.mjs + init.sh + init.ps1 + las 2 SKILL.md de _project-docs)`);
