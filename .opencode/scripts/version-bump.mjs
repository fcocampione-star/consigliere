#!/usr/bin/env node
/**
 * version-bump.mjs — sube la versión del harness de una sola pasada.
 * Uso:
 *   node .opencode/scripts/version-bump.mjs <patch|minor|major> [--dry-run]
 *   node .opencode/scripts/version-bump.mjs --set <X.Y.Z> [--dry-run]
 *
 * ROOT-ONLY (dev): un proyecto instalado no bumpea su propio paquete npm, así que
 * este script no se espeja en `templates/` (catalogado en `ROOT_ONLY_EXACT`).
 *
 * Qué reescribe: los 5 destinos de `TARGETS` (`init.mjs`, `init.sh`, `init.ps1`
 * y las 2 `_project-docs/SKILL.md`) y `package.json` AL FINAL, que es la fuente
 * de la versión. No invoca git ni `npm version`: el commit, el merge `--ff-only`
 * y el tag son pasos manuales del release (ver CONTRIBUTING › Publicación).
 *
 * EOL: cada destino se lee y se escribe CRUDO (`readFileSync(...,'utf8')` +
 * sustitución in-place). `readText` de lib/core.mjs normaliza a LF y dejaría
 * `init.ps1` con LF en el working tree y EN EL TARBALL (`npm pack` lee disco;
 * `.gitattributes` no protege el pack), que es justo el drift que el contrato
 * `eol templates` persigue.
 *
 * Exit: 0 ok (incluye `--dry-run` y el `--set` idempotente, que no escribe),
 *       1 uso o valor inválido, 2 los destinos YA derivan (no se toca nada),
 *       3 un destino no tiene exactamente 1 ocurrencia (o la verificación
 *         post-escritura falló: los originales se restauran antes de salir).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, writeAtomic, exitUsage, EXIT_CODES } from './lib/core.mjs';
import { TARGETS, checkVersion } from './version-check.mjs';

const PKG = 'package.json';
// Semver estricto, sin prerelease ni build: una versión con sufijo no es
// comparable ni publicable como `latest` y aquí solo genera ambigüedad.
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// El campo `"version"` del package.json se sustituye in-place (grupo 2 = valor):
// un `JSON.stringify` reformatearía el fichero entero (churn de formato en cada
// bump) por cambiar un string.
const PKG_VERSION_RE = /"version"(\s*:\s*)"([^"]*)"/;

const EXIT = Object.freeze({
  OK: EXIT_CODES.OK, // 0
  USO: EXIT_CODES.USO, // 1
  DRIFT: 2, // drift preexistente: el bump multiplicaría el problema
  MATCH: 3, // un destino sin exactamente 1 ocurrencia (o verificación post-escritura)
});

const KINDS = ['patch', 'minor', 'major'];

/** Error con código de salida propio: el CLI lo imprime y sale con él; los tests lo miran. */
class BumpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BumpError';
    this.code = code;
  }
}

/** Lee un fichero del destino CRUDO (EOL y BOM intactos), nunca normalizado. */
function readRaw(root, rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch (e) {
    throw new BumpError(EXIT.MATCH, `${rel}: no se pudo leer (${e.code || e.message})`);
  }
}

/** Todas las coincidencias de `re` (clon con `g`: el original no arrastra `lastIndex`). */
function occurrences(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return [...text.matchAll(g)];
}

/** Clon con flag `d`: da los índices del grupo, la única forma fiable de sustituir solo ese tramo. */
function indexed(re) {
  return new RegExp(re.source, re.flags.includes('d') ? re.flags : `${re.flags}d`);
}

/**
 * Sustituye el grupo `group` de la ÚNICA coincidencia de `re` por `version`.
 * Devuelve `{ ok, count, from, text }`; con 0 o 2+ coincidencias no toca el texto
 * (`ok: false`) porque un reemplazo ciego reescribiría algo que nadie revisó.
 */
function rewrite(text, re, version, group = 1) {
  const hits = occurrences(re, text);
  if (hits.length !== 1) return { ok: false, count: hits.length };
  const m = indexed(re).exec(text);
  const [start, end] = m.indices[group];
  return { ok: true, count: 1, from: m[group], text: text.slice(0, start) + version + text.slice(end) };
}

function parseSemver(value, label) {
  const m = SEMVER_RE.exec(String(value ?? ''));
  if (!m) throw new BumpError(EXIT.USO, `${label} no es semver X.Y.Z (sin prerelease ni build): ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function nextSemver(current, kind) {
  const [major, minor, patch] = current;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * `bump(root, {kind|set, dryRun})` → `{ current, next, changed, plan }`, con
 * `plan = [{file, from, to, count}]` (los 5 destinos y `package.json` al final).
 *
 * Fases, todas en memoria hasta la escritura: (1) plan estructural — cada destino
 * tiene que declarar la constante UNA sola vez (MATCH: 0 o 2+ ocurrencias); (2)
 * preflight de drift — los 5 destinos tienen que coincidir con el `package.json`
 * actual (DRIFT), porque escribir encima multiplicaría el desalineamiento; (3)
 * escritura atómica con `package.json` al final; (4) verificación con
 * `checkVersion`. Cualquier fallo de (3) o (4) restaura los originales: un fallo a
 * mitad no deja 4 destinos sucios (el siguiente run abortaría en el preflight sin
 * poder arreglarlo).
 *
 * El orden 1→2 es deliberado: una constante AUSENTE o DUPLICADA es un problema
 * estructural del destino (no hay versión que alinear), así que sale 3 y no 2 —
 * el 2 queda reservado para "declara otra versión".
 */
export function bump(root, { kind = null, set = null, dryRun = false } = {}) {
  if (kind && set) throw new BumpError(EXIT.USO, 'el kind (patch|minor|major) y --set son mutuamente excluyentes');
  if (!kind && !set) throw new BumpError(EXIT.USO, 'falta el kind (patch|minor|major) o --set <X.Y.Z>');
  if (kind && !KINDS.includes(kind)) throw new BumpError(EXIT.USO, `kind inválido: ${kind} (usar ${KINDS.join('|')})`);

  const pkgRaw = readRaw(root, PKG);
  const pkgHits = occurrences(PKG_VERSION_RE, pkgRaw);
  if (pkgHits.length !== 1) {
    throw new BumpError(EXIT.MATCH, `${PKG}: se esperaba exactamente 1 campo "version" (encontrados ${pkgHits.length})`);
  }
  const current = pkgHits[0][2];
  const currentParsed = parseSemver(current, `${PKG}: versión actual`);

  const next = set ? String(set).trim() : nextSemver(currentParsed, kind);
  const nextParsed = parseSemver(next, '--set');
  const order = compareSemver(nextParsed, currentParsed);
  if (order < 0) throw new BumpError(EXIT.USO, `la versión nueva (${next}) es menor que la actual (${current})`);
  // `--set` con la versión ya puesta no es un error: es el escape hatch
  // idempotente (nada que reescribir, exit 0 sin tocar disco).
  if (order === 0) return { current, next, changed: false, plan: [] };

  // (1) Plan en memoria: un destino con 0 o 2+ coincidencias aborta el bump
  // completo (escribir 4 y fallar en el quinto es peor que no escribir).
  const writes = [];
  const bad = [];
  for (const [rel, re] of TARGETS) {
    const before = readRaw(root, rel);
    const out = rewrite(before, re, next);
    if (!out.ok) { bad.push(`${rel}: ${out.count} ocurrencias (esperada exactamente 1)`); continue; }
    writes.push({ file: rel, from: out.from, to: next, count: out.count, text: out.text, orig: before });
  }
  // `package.json` se reescribe al final, con el mismo contrato de 1 sola coincidencia.
  const pkgOut = rewrite(pkgRaw, PKG_VERSION_RE, next, 2);
  if (!pkgOut.ok) bad.push(`${PKG}: ${pkgOut.count} campos "version" (esperado exactamente 1)`);
  else writes.push({ file: PKG, from: current, to: next, count: 1, text: pkgOut.text, orig: pkgRaw });
  if (bad.length) {
    throw new BumpError(EXIT.MATCH, `no se puede reescribir con exactamente 1 ocurrencia:\n${bad.map((b) => `   - ${b}`).join('\n')}`);
  }

  // (2) Preflight de drift: los destinos tienen que cuadrar con la versión actual.
  const drift = checkVersion(root, current);
  if (drift.length) {
    throw new BumpError(
      EXIT.DRIFT,
      `los destinos ya derivan de ${PKG} (${current}); arregla el drift antes de bumpear:\n` +
        drift.map((d) => `   - ${d}`).join('\n'),
    );
  }

  const plan = writes.map(({ file, from, to, count }) => ({ file, from, to, count }));
  if (dryRun) return { current, next, changed: true, plan };

  // (3) Escritura atómica (temp + rename) + (4) verificación; rollback si algo falla.
  const originals = new Map();
  try {
    for (const w of writes) {
      originals.set(w.file, w.orig);
      writeAtomic(join(root, w.file), w.text);
    }
    const post = checkVersion(root, next);
    if (post.length) {
      throw new BumpError(
        EXIT.MATCH,
        `verificación post-escritura falló (se restauran los originales):\n${post.map((d) => `   - ${d}`).join('\n')}`,
      );
    }
  } catch (e) {
    const restoreFailures = [];
    for (const [rel, text] of originals) {
      try { writeAtomic(join(root, rel), text); }
      catch (err) { restoreFailures.push(`${rel}: ${err.code || err.message}`); }
    }
    if (restoreFailures.length) {
      throw new BumpError(EXIT.MATCH, `${e.message}\n❌ rollback incompleto, revisa a mano:\n${restoreFailures.map((r) => `   - ${r}`).join('\n')}`);
    }
    throw e instanceof BumpError ? e : new BumpError(EXIT.MATCH, `escritura falló y se restauraron los originales: ${e.message}`);
  }

  return { current, next, changed: true, plan };
}

const USO = [
  'Uso:',
  '  node .opencode/scripts/version-bump.mjs <patch|minor|major> [--dry-run]',
  '  node .opencode/scripts/version-bump.mjs --set <X.Y.Z> [--dry-run]',
  '',
  'Reescribe los 5 destinos de la versión (init.mjs, init.sh, init.ps1 y las 2',
  'SKILL.md de _project-docs) y package.json AL FINAL. No invoca git.',
  'Exit: 0 ok · 1 uso · 2 drift preexistente · 3 destino sin 1 única ocurrencia.',
].join('\n');

function parseArgs(argv) {
  let kind = null;
  let set = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--help' || a === '-h') { console.log(USO); process.exit(EXIT.OK); }
    else if (a === '--set') {
      set = argv[++i];
      if (set === undefined || set.startsWith('-')) exitUsage(`version-bump: --set necesita <X.Y.Z>\n${USO}`);
    } else if (a.startsWith('--set=')) set = a.slice('--set='.length);
    else if (a.startsWith('-')) exitUsage(`version-bump: flag desconocido: ${a}\n${USO}`);
    else if (kind === null) kind = a;
    else exitUsage(`version-bump: argumento de más: ${a}\n${USO}`);
  }
  if (kind && set) exitUsage(`version-bump: el kind y --set son mutuamente excluyentes\n${USO}`);
  if (!kind && !set) exitUsage(`version-bump: falta <patch|minor|major> o --set <X.Y.Z>\n${USO}`);
  return { kind, set, dryRun };
}

function main() {
  const root = join(import.meta.dirname, '..', '..');
  const { kind, set, dryRun } = parseArgs(process.argv.slice(2));

  let out;
  try {
    out = bump(root, { kind, set, dryRun });
  } catch (e) {
    console.error(`❌ version-bump: ${e.message}`);
    process.exit(e instanceof BumpError ? e.code : EXIT.MATCH);
  }

  if (!out.changed) {
    console.log(`✅ ${PKG} ya está en ${out.next}: nada que reescribir (--set idempotente)`);
    process.exit(EXIT.OK);
  }
  if (dryRun) {
    console.log(`dry-run — ${out.current} → ${out.next} (${out.plan.length} ficheros, no se escribió nada)`);
    for (const p of out.plan) console.log(`  ${p.file} | ${p.from} → ${p.to} | ${p.count} ocurrencia(s)`);
    process.exit(EXIT.OK);
  }

  console.log(
    `✅ ${PKG} ${out.current} → ${out.next}; ${TARGETS.length} destinos reescritos ` +
      `(${out.plan.length - 1} + ${PKG}). Siguiente: npm test → ff-merge → tag v${out.next}`,
  );
  process.exit(EXIT.OK);
}

if (isMain(import.meta.url, process.argv[1])) main();
