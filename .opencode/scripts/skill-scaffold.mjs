#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — skill-scaffold.mjs
 * Uso: node .opencode/scripts/skill-scaffold.mjs <name> [--description ".."] [--chunks a,b] [--write] [--force]
 * Exit: 0 ok (dry-run imprime el esqueleto por stdout; `--write` lo escribe), 1 uso inválido o destino existente.
 *
 * Genera el esqueleto de una skill de proyecto en
 * `.opencode/skills/<name>/SKILL.md`. Por defecto es DRY-RUN: imprime por stdout
 * y no toca el disco. Solo escribe con `--write` (atómico, vía `writeAtomic`) y
 * nunca sobrescribe un SKILL.md existente sin `--force`.
 *
 * El frontmatter lleva `name` == directorio, `description` en una línea y
 * `chunks: [...]` con un marcador `<!-- CHUNK: x -->` por chunk, de modo que la
 * salida es válida para `_skill-loader/loader.mjs`.
 *
 * Reglas: ESM, Node >= 20.11 (`import.meta.dirname`), cero dependencias;
 * utilidades de `lib/core.mjs`, nunca reimplementadas.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { writeAtomic, EXIT_CODES, exitUsage, fail, isMain } from './lib/core.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SKILLS_DIR = join(ROOT, '.opencode', 'skills');
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const NAME_MAX = 64;
const DEFAULT_CHUNKS = ['urls', 'patterns', 'shortcuts'];

const USAGE = `Uso:
  node .opencode/scripts/skill-scaffold.mjs <name> [--description ".."] [--chunks a,b] [--write] [--force]

Flags:
  --description  descripción de una línea (default: "Skill de proyecto <name>.")
  --chunks       chunks separados por coma (default: ${DEFAULT_CHUNKS.join(',')})
  --write        escribe .opencode/skills/<name>/SKILL.md (sin él, dry-run por stdout)
  --force        permite sobrescribir un SKILL.md existente`;

// ── Funciones puras ─────────────────────────────────────────────────────────

/** Devuelve `null` si el nombre es válido, o un mensaje de error. */
export function validateName(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'falta el nombre de la skill';
  if (n.length > NAME_MAX) return `el nombre supera ${NAME_MAX} caracteres`;
  if (!NAME_RE.test(n)) return `nombre inválido "${n}": usa ^[a-z0-9][a-z0-9-]*$`;
  return null;
}

/** Normaliza y deduplica la lista de chunks; lanza si alguno es inválido. */
export function normalizeChunks(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const out = [];
  for (const raw of list) {
    const c = String(raw).trim().toLowerCase();
    if (!c) continue;
    if (!NAME_RE.test(c)) throw new Error(`chunk inválido "${c}": usa ^[a-z0-9][a-z0-9-]*$`);
    if (!out.includes(c)) out.push(c);
  }
  return out.length ? out : [...DEFAULT_CHUNKS];
}

/** Colapsa un texto a UNA línea (la `description` del frontmatter nunca lleva saltos). */
export function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** `render(name, description, chunks)` → contenido completo del SKILL.md. */
export function render(name, description, chunks) {
  const desc = oneLine(description) || `Skill de proyecto ${name}.`;
  const yamlDesc = `"${desc.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const body = chunks
    .map((c) => `<!-- CHUNK: ${c} -->\n## ${c}\n\n(pendiente: contenido de ${c})\n\n<!-- /CHUNK -->`)
    .join('\n\n');
  return `---\nname: ${name}\ndescription: ${yamlDesc}\nchunks: [${chunks.join(', ')}]\n---\n\n# ${name}\n\n${body}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { name: '', description: '', chunks: '', write: false, force: false, unknown: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') opts.write = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--description') opts.description = argv[++i] ?? '';
    else if (a.startsWith('--description=')) opts.description = a.slice('--description='.length);
    else if (a === '--chunks') opts.chunks = argv[++i] ?? '';
    else if (a.startsWith('--chunks=')) opts.chunks = a.slice('--chunks='.length);
    else if (a.startsWith('-')) opts.unknown = a;
    else rest.push(a);
  }
  opts.name = rest.join(' ').trim();
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.unknown) exitUsage(`skill-scaffold.mjs: flag desconocido "${opts.unknown}"\n\n${USAGE}`);

  const nameError = validateName(opts.name);
  if (nameError) exitUsage(`skill-scaffold.mjs: ${nameError}\n\n${USAGE}`);

  let chunks;
  try {
    chunks = normalizeChunks(opts.chunks);
  } catch (e) {
    exitUsage(`skill-scaffold.mjs: ${e.message}\n\n${USAGE}`);
  }

  const content = render(opts.name, opts.description, chunks);

  if (!opts.write) {
    process.stdout.write(content);
    return;
  }

  const target = join(SKILLS_DIR, opts.name, 'SKILL.md');
  if (existsSync(target) && !opts.force) {
    fail('skill-scaffold', `ya existe ${target}; usa --force para sobrescribir`, EXIT_CODES.USO);
  }
  writeAtomic(target, content);
  console.log(`skill-scaffold: escrito ${target}`);
}

if (isMain(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2));
}
