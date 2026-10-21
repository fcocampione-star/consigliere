#!/usr/bin/env node
/**
 * version-check.mjs — single-source de la versión del harness.
 * Uso: node .opencode/scripts/version-check.mjs
 *
 * Módulo PURO + CLI: importarlo no ejecuta nada (todo el cuerpo vive en
 * funciones y el CLI arranca solo vía `isMain`), de modo que `version-bump.mjs`
 * reutiliza `TARGETS` / `SKILL_VERSION_RE` / `checkVersion` en vez de duplicar
 * los regexes de cada destino.
 *
 * La versión tiene UNA sola fuente (`package.json`) y 5 destinos que la repiten;
 * este script comprueba que no derivan.
 * Exit: 0 = los 5 destinos (init.mjs, init.sh, init.ps1 y las 2 SKILL.md de
 * _project-docs: raíz + plantilla) coinciden con `package.json`, 1 = drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, EXIT_CODES } from './lib/core.mjs';

// La versión NO puede vivir solo en `package.json`: hay una segunda fuente
// documental que la repite y que se lee en cada sesión (`_project-docs/SKILL.md`,
// una por copia: la del repo y la que se instala). Las dos se comprueban porque
// son las dos que se distribuyen; una de las dos desalineada es drift real.
export const SKILL_REL = '.opencode/skills/_project-docs/SKILL.md';
// La versión aparece pegada a la invocación recomendada (`vX.Y.Z via npx
// advisor-harness@latest`): el ancla es esa forma y no un `X.Y.Z` suelto, para no
// capturar otras versiones del documento (p. ej. `metadata.version`, que es la
// versión de la skill, no la del harness).
// Sin flag `g` a propósito: el regex se reutiliza (match y reescritura), y un
// `g` compartido arrastraría `lastIndex` entre llamadas.
export const SKILL_VERSION_RE = /\bv(\d+\.\d+\.\d+)\b(?=[^|\n]*\bvia npx advisor-harness@latest)/;

export const TARGETS = [
  ['init.mjs', /const VERSION = '([^']+)'/],
  ['init.sh', /^VERSION="([^"]+)"/m],
  ['init.ps1', /^\$HARNESS_VERSION = "([^"]+)"/m],
  [SKILL_REL, SKILL_VERSION_RE],
  // Literal POSIX (no `join`): la ruta se imprime en la tabla del `--dry-run` y
  // se compara/nombra igual en cualquier SO; `readFileSync` acepta `/` en win32.
  [`templates/${SKILL_REL}`, SKILL_VERSION_RE],
];

/**
 * `checkVersion(root, expected)` → lista de drift (vacía = todo alineado).
 *
 * Puro en el sentido que importa aquí: no imprime, no sale del proceso y no
 * escribe; solo lee. `expected` es la versión canónica y, si se omite, se toma
 * de `package.json` en `root`. Cada entrada de la lista es un destino que no se
 * pudo leer, que no declara la constante o que declara otra versión.
 */
export function checkVersion(root, expected) {
  let want = expected;
  if (want === undefined || want === null) {
    try {
      want = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    } catch (e) {
      return [`package.json: no se pudo leer la versión (${e.code || e.message})`];
    }
  }
  const drift = [];
  for (const [rel, re] of TARGETS) {
    let found = null;
    try { found = readFileSync(join(root, rel), 'utf8').match(re); }
    catch (e) { drift.push(`${rel}: no se pudo leer (${e.code || e.message})`); continue; }
    if (!found) drift.push(`${rel}: no se encontró la constante de versión`);
    else if (found[1] !== want) drift.push(`${rel}: declara v${found[1]} (esperado v${want})`);
  }
  return drift;
}

function main() {
  const root = join(import.meta.dirname, '..', '..');
  let expected;
  try {
    expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  } catch (e) {
    console.error(`❌ no se pudo leer package.json: ${e.code || e.message}`);
    process.exit(EXIT_CODES.USO);
  }

  const drift = checkVersion(root, expected);
  if (drift.length) {
    console.error(`❌ version desalineada respecto a package.json (${expected}):`);
    for (const d of drift) console.error(`   - ${d}`);
    process.exit(EXIT_CODES.USO);
  }

  console.log(`✅ version consistente: ${expected} (${TARGETS.length} ficheros: init.mjs + init.sh + init.ps1 + las 2 SKILL.md de _project-docs)`);
}

if (isMain(import.meta.url, process.argv[1])) main();
