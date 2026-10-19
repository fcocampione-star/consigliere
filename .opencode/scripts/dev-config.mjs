#!/usr/bin/env node
/**
 * dev-config.mjs — genera la `opencode.json` LOCAL del repo dev (gitignored).
 * Uso: node .opencode/scripts/dev-config.mjs [--check | --force]
 * Exit: 0 ok (incluye el no-op) · 1 error de uso o config ausente/inválida.
 *
 * POR QUÉ EXISTE (dev-only, solo raíz):
 * Este repo ES el origen del harness y NO puede instalarse sobre sí mismo
 * (`refuseHarnessSource` en init.mjs), así que la `opencode.json` que opencode
 * carga en la raíz no la escribe el instalador. El `.gitignore` ancla
 * `/opencode.json`, de modo que un clon limpio no la trae y `doctor` (que ya no
 * tiene fallback, D2) marca `opencode.json` en ❌ hasta que se genera. Este
 * script es esa pieza local: transforma la plantilla PÚBLICA
 * `templates/opencode.json` a la config DEV, resolviendo cada `{{MODEL_*}}` a
 * cadena vacía (heredar modelo), que es exactamente lo que hace `init.mjs`
 * (buildVars: `MODEL_*` por defecto `''`; renderFile: sustitución de cadena).
 *
 * La transformación está duplicada A PROPÓSITO: `init.mjs` llama a `main()` al
 * importarse, así que su renderer no es reutilizable sin ejecutar el instalador.
 * El guardián contra drift de esa duplicación es `test/dev-config.test.mjs`
 * (propiedad derivada: 7 agentes, 7 placeholders → `''`, JSON válido, cero `{{`).
 *
 * Modos:
 *   (sin flags)  genera si falta; si ya existe es NO-OP exit 0 (protege los
 *                modelos personalizados con `routine-model.mjs --persist`).
 *   --force      regenera siempre desde la plantilla (pisa lo personalizado).
 *   --check      assert de frescura: exit 0 solo si existe, parsea y no deja
 *                ningún `{{...}}`; exit 1 en cualquier otro caso. Cableado a
 *                tests/CI. No escribe.
 *
 * Cero dependencias; escribe con EOL canónico (LF) vía lib/core.mjs.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, readText, writeAtomic, exitUsage, fail, EXIT_CODES } from './lib/core.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const TEMPLATE = join(ROOT, 'templates', 'opencode.json');
const TARGET = join(ROOT, 'opencode.json');

// Solo los placeholders de modelo: son los únicos que `templates/opencode.json`
// cita y los únicos que la config dev debe resolver a cadena vacía.
const MODEL_PLACEHOLDER_RE = /\{\{MODEL_[A-Z_]+\}\}/g;
// Cualquier `{{...}}` que sobreviva delata un placeholder nuevo sin resolver:
// un `--check` verde con él mentiría (opencode no sabe resolverlo).
const ANY_PLACEHOLDER_RE = /\{\{[^}]*\}\}/;

/**
 * Transforma el TEXTO de `templates/opencode.json` en la config dev: cada
 * `{{MODEL_*}}` → `''` (vacíos: heredar), EOL normalizado a LF.
 *
 * PURA (mismo texto → mismo texto) y valida antes de devolver: si el resultado
 * no parsea o conserva un `{{...}}`, lanza. Esa validación es el contrato que
 * comparten el CLI y los tests: nunca se devuelve una config rota.
 */
export function renderDevConfig(templateText) {
  // `\r` no es significativo en JSON fuera de cadenas (solo whitespace), así que
  // normalizar a LF es seguro y fija el EOL canónico del repo.
  const lf = String(templateText).replace(/\r\n?/g, '\n');
  const out = lf.replace(MODEL_PLACEHOLDER_RE, '');
  try {
    JSON.parse(out);
  } catch (e) {
    throw new Error(`la config dev generada no es JSON válido: ${e.message}`);
  }
  const leftover = out.match(ANY_PLACEHOLDER_RE);
  if (leftover) throw new Error(`placeholder sin resolver en la config dev: ${leftover[0]}`);
  return out;
}

const USO = [
  'Uso:',
  '  node .opencode/scripts/dev-config.mjs            genera si falta (no-op si existe)',
  '  node .opencode/scripts/dev-config.mjs --force    regenera desde templates/opencode.json',
  '  node .opencode/scripts/dev-config.mjs --check    exit 0 si existe, parsea y no deja {{...}}',
].join('\n');

function generar() {
  if (!existsSync(TEMPLATE)) fail('dev-config', `no existe la plantilla ${TEMPLATE}`);
  const rendered = renderDevConfig(readText(TEMPLATE));
  writeAtomic(TARGET, rendered);
  console.log(`dev-config: generada ${TARGET} desde templates/opencode.json ({{MODEL_*}} = "")`);
}

function comprobar() {
  if (!existsSync(TARGET)) {
    console.error(`dev-config --check: falta ${TARGET} (genera con \`npm run dev:config\`)`);
    return EXIT_CODES.USO;
  }
  const raw = readText(TARGET);
  try {
    JSON.parse(raw);
  } catch (e) {
    console.error(`dev-config --check: ${TARGET} no es JSON válido: ${e.message}`);
    return EXIT_CODES.USO;
  }
  const leftover = raw.match(ANY_PLACEHOLDER_RE);
  if (leftover) {
    console.error(`dev-config --check: ${TARGET} conserva el placeholder ${leftover[0]} (regenera con --force)`);
    return EXIT_CODES.USO;
  }
  console.log(`dev-config --check: ${TARGET} presente, JSON válido y sin placeholders`);
  return EXIT_CODES.OK;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const force = args.includes('--force');
  if (args.includes('--help') || args.includes('-h')) { console.log(USO); process.exit(EXIT_CODES.OK); }
  const unknown = args.find((a) => !['--check', '--force', '--help', '-h'].includes(a));
  if (unknown) exitUsage(`dev-config: flag desconocido: ${unknown}\n${USO}`);
  if (check && force) exitUsage(`dev-config: --check y --force son mutuamente excluyentes\n${USO}`);

  if (check) process.exit(comprobar());
  if (existsSync(TARGET) && !force) {
    console.log(`dev-config: ${TARGET} ya existe — no-op (usa --force para regenerar)`);
    process.exit(EXIT_CODES.OK);
  }
  generar();
  process.exit(EXIT_CODES.OK);
}

if (isMain(import.meta.url, process.argv[1])) main();
