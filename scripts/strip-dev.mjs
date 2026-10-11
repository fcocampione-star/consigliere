#!/usr/bin/env node
/**
 * strip-dev.mjs — regenera la rama de distribución (`main`) desde `dev`.
 * Uso: node scripts/strip-dev.mjs [--dry-run] [--push] [--allow-dirty] [...]
 *
 * `dev` es el repo COMPLETO (desarrollo); `main` es la DISTRIBUCIÓN (harness +
 * memoria, sin dev-only). Este script construye el árbol de `main` a partir del
 * árbol de `dev` quitando las rutas de desarrollo e inyectando el
 * `opencode.json` de distribución (blob idéntico a `templates/opencode.json`).
 *
 * Trabaja SIEMPRE sobre el índice de git (con un `GIT_INDEX_FILE` temporal en
 * `os.tmpdir()`), nunca sobre el working tree: el repo del usuario queda intacto.
 *
 * Reglas: ESM, Node >= 20.11 (`import.meta.dirname`), cero dependencias;
 * `EXIT_CODES`/`isMain` vienen de `.opencode/scripts/lib/core.mjs` (no se
 * reimplementan). Sin glifos: salida en texto plano.
 *
 * Idempotencia: si el árbol resultante coincide con el de `main`, no se escribe
 * nada y sale 0 ("main ya al día"). La escritura del ref es CAS (`update-ref`
 * con el valor viejo) y el push usa `--force-with-lease`, nunca `--force`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EXIT_CODES, isMain, exitUsage, fail } from '../.opencode/scripts/lib/core.mjs';

const DEFAULT_BRANCH = 'dev';
const DEFAULT_TARGET = 'main';
const DEFAULT_REMOTE = 'origin';

// Rutas de desarrollo que NO viajan a la rama de distribución. Son rutas
// EXPLÍCITAS (nunca globs `**`): el borrado del índice debe ser determinista, y
// el prefijo `${e}/` cubre recursivamente los directorios sin pathspec mágico.
const EXCLUDED = [
  'test',
  '.github',
  'scripts',
  '.nvmrc',
  'CONTRIBUTING.md',
  '.opencode/scripts/contract-tests.mjs',
  '.opencode/scripts/lint-sh.mjs',
  '.opencode/scripts/memory-rotate.test.mjs',
  '.opencode/scripts/version-check.mjs',
];
const isExcluded = (p) => EXCLUDED.some((e) => p === e || p.startsWith(`${e}/`));

const USAGE = `Uso:
  node scripts/strip-dev.mjs [--dry-run] [--push] [--allow-dirty]
                            [--branch dev] [--target main] [--remote origin]
                            [--message "..."]

Regenera la rama de distribución (main por defecto) desde el árbol de la rama
de desarrollo (dev por defecto), quitando las rutas dev-only e inyectando el
opencode.json de distribución. Trabaja sobre un índice de git temporal: no toca
el working tree.

Flags:
  --dry-run        imprime el árbol resultante y su diff-stat; no escribe refs
  --push           push --force-with-lease al remote tras actualizar el ref
  --allow-dirty    permite HEAD != rama fuente y árbol de trabajo sucio
  --branch <n>     rama fuente (default: ${DEFAULT_BRANCH})
  --target <n>     rama objetivo (default: ${DEFAULT_TARGET})
  --remote <n>     remote para --push (default: ${DEFAULT_REMOTE})
  --message <s>    mensaje de commit (default: generado con el short-sha)
  -h, --help       muestra esta ayuda

Exit: 0 ok (o main ya al día) · 1 uso/guardas/allowlist · 3 falta git · 5 push falló`;

// Raíz del repo, resuelta tras comprobar que git está disponible.
let REPO_ROOT = process.cwd();

/**
 * Ejecuta git en la raíz del repo. `indexFile` fija `GIT_INDEX_FILE` para las
 * operaciones de índice (read-tree/rm/update-index); el resto usa el normal.
 */
function git(args, { input, indexFile } = {}) {
  const env = { ...process.env };
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', input, env });
}

/** Igual que `git` pero exige éxito (exit 0); devuelve stdout sin el \n final. */
function mustGit(args, opts) {
  const res = git(args, opts);
  if (res.error) fail('strip-dev', `no se pudo ejecutar git: ${res.error.message}`, EXIT_CODES.DEPENDENCIA);
  if (res.status !== 0) fail('strip-dev', (res.stderr || res.stdout || `git ${args.join(' ')}`).trim(), EXIT_CODES.USO);
  return (res.stdout || '').trim();
}

function parseArgs(argv) {
  const opts = {
    dryRun: false, push: false, allowDirty: false, help: false,
    branch: DEFAULT_BRANCH, target: DEFAULT_TARGET, remote: DEFAULT_REMOTE,
    message: '', unknown: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--push') opts.push = true;
    else if (a === '--allow-dirty') opts.allowDirty = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--branch') opts.branch = argv[++i] ?? '';
    else if (a.startsWith('--branch=')) opts.branch = a.slice('--branch='.length);
    else if (a === '--target') opts.target = argv[++i] ?? '';
    else if (a.startsWith('--target=')) opts.target = a.slice('--target='.length);
    else if (a === '--remote') opts.remote = argv[++i] ?? '';
    else if (a.startsWith('--remote=')) opts.remote = a.slice('--remote='.length);
    else if (a === '--message') opts.message = argv[++i] ?? '';
    else if (a.startsWith('--message=')) opts.message = a.slice('--message='.length);
    else opts.unknown = a;
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(`${USAGE}\n`); return; }
  if (opts.unknown) exitUsage(`strip-dev: flag desconocido "${opts.unknown}"\n\n${USAGE}`);
  if (!opts.branch || !opts.target) exitUsage(`strip-dev: --branch/--target no pueden estar vacíos\n\n${USAGE}`);

  // ── Guardas de entorno ────────────────────────────────────────────────────
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    fail('strip-dev', `git no está disponible en el PATH (dependencia requerida): ${probe.error.message}`, EXIT_CODES.DEPENDENCIA);
  }

  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) fail('strip-dev', 'no estamos dentro de un repositorio git', EXIT_CODES.USO);
  REPO_ROOT = top.stdout.trim();

  const { branch, target } = opts;
  const sourceRef = `refs/heads/${branch}`;
  const targetRef = `refs/heads/${target}`;

  if (git(['rev-parse', '--verify', '--quiet', sourceRef]).status !== 0)
    fail('strip-dev', `la rama fuente "${branch}" no existe (${sourceRef})`, EXIT_CODES.USO);

  if (!opts.allowDirty) {
    const head = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const headBranch = head.status === 0 ? head.stdout.trim() : '';
    if (headBranch !== branch)
      fail('strip-dev', `HEAD no está en "${branch}" (está en "${headBranch || 'detached'}"); usa --allow-dirty para forzar`, EXIT_CODES.USO);

    const dirty = (git(['status', '--porcelain']).stdout || '').trim();
    if (dirty)
      fail('strip-dev', `el árbol de trabajo no está limpio (${dirty.split('\n').length} entrada(s)); usa --allow-dirty para forzar`, EXIT_CODES.USO);
  }

  // La rama objetivo no puede estar checkouteada en ningún worktree: escribir el
  // ref de la rama que el usuario tiene delante dejaría su índice/worktree mental
  // desincronizado del ref.
  const wt = (git(['worktree', 'list', '--porcelain']).stdout || '');
  if (wt.split('\n').includes(`branch ${targetRef}`))
    fail('strip-dev', `la rama objetivo "${target}" está checkouteada en un worktree; cámbiala antes de regenerar`, EXIT_CODES.USO);

  // ── Árboles de origen y destino ───────────────────────────────────────────
  const devTree = mustGit(['rev-parse', `${sourceRef}^{tree}`]);
  const mainTreeRes = git(['rev-parse', '--verify', '--quiet', `${targetRef}^{tree}`]);
  const mainTree = mainTreeRes.status === 0 ? mainTreeRes.stdout.trim() : null;
  const oldMainRes = git(['rev-parse', '--verify', '--quiet', targetRef]);
  const oldMain = oldMainRes.status === 0 ? oldMainRes.stdout.trim() : '';

  // ── Construcción del árbol de distribución sobre un índice temporal ───────
  const idxDir = mkdtempSync(join(tmpdir(), 'strip-dev-'));
  const indexFile = join(idxDir, 'index');
  const cleanup = () => { try { rmSync(idxDir, { recursive: true, force: true }); } catch { /* best-effort */ } };
  // `fail()` sale con process.exit, que NO ejecuta `finally`: el handler de
  // 'exit' (y las señales) garantiza que el índice temporal nunca quede huérfano.
  process.once('exit', cleanup);
  const bail = () => { cleanup(); process.exit(EXIT_CODES.USO); };
  process.once('SIGINT', bail);
  process.once('SIGTERM', bail);

  let tree;
  try {
    mustGit(['read-tree', devTree], { indexFile });
    // Borrado index-only de las rutas dev-only: `--cached` nunca toca el working
    // tree; `--ignore-unmatch` tolera una ruta ausente en el árbol de origen.
    mustGit(['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', ...EXCLUDED], { indexFile });

    // Inyecta el opencode.json de distribución: mismo blob que la plantilla,
    // referenciado por hash (determinista, sin parsear ni reescribir el JSON).
    const blob = mustGit(['rev-parse', `${sourceRef}:templates/opencode.json`]);
    mustGit(['update-index', '--add', '--cacheinfo', `100644,${blob},opencode.json`], { indexFile });

    tree = mustGit(['write-tree'], { indexFile });

    // Allowlist/safety: el árbol resultante NO puede contener ninguna ruta de la
    // lista de exclusión, y no puede estar vacío. Un fallo aquí es la red que
    // atrapa una exclusión incompleta antes de escribir ningún ref.
    const paths = mustGit(['ls-tree', '-r', '--name-only', tree]).split('\n').filter(Boolean);
    if (paths.length === 0) fail('strip-dev', 'el árbol resultante está vacío', EXIT_CODES.USO);
    const leaked = paths.filter(isExcluded);
    if (leaked.length) fail('strip-dev', `el árbol resultante contiene rutas dev-only (allowlist rota): ${leaked.join(', ')}`, EXIT_CODES.USO);
  } finally {
    cleanup();
  }

  // ── Idempotencia ──────────────────────────────────────────────────────────
  if (mainTree && mainTree === tree) {
    console.log(`strip-dev: ${target} ya al día (árbol idéntico ${tree})`);
    return;
  }

  // ── Dry-run: muestra el resultado sin escribir refs ───────────────────────
  if (opts.dryRun) {
    const base = mainTree || mustGit(['mktree'], { input: '' });
    console.log(`strip-dev: nuevo árbol ${tree}`);
    console.log(`strip-dev: ${mainTree ? `diff vs ${target}` : 'diff vs árbol vacío'}`);
    process.stdout.write(git(['diff-tree', '--stat', base, tree]).stdout || '');
    return;
  }

  // ── Commit y actualización del ref (CAS) ──────────────────────────────────
  const shortSha = mustGit(['rev-parse', '--short', sourceRef]);
  const message = opts.message || `chore(dist): regenerar ${target} desde ${branch}@${shortSha} (strip-dev)`;
  const commitArgs = ['-c', 'user.name=CONSIGLIERE', '-c', 'user.email=consigliere@local', 'commit-tree', tree];
  if (oldMain) commitArgs.push('-p', oldMain);
  commitArgs.push('-m', message);
  const newCommit = mustGit(commitArgs);

  const upd = git(['update-ref', targetRef, newCommit, oldMain]);
  if (upd.status !== 0)
    fail('strip-dev', (upd.stderr || '').trim() || `no se pudo actualizar ${targetRef}`, EXIT_CODES.USO);

  console.log(`strip-dev: ${targetRef} -> ${newCommit}`);
  console.log(`strip-dev: ${message}`);

  // ── Push opcional (force-with-lease, nunca --force) ───────────────────────
  if (opts.push) {
    const lease = `${target}:${oldMain}`;
    const res = git(['push', `--force-with-lease=${lease}`, opts.remote, target]);
    if (res.status !== 0) {
      // El ref local YA se movió: el fallo deja un estado parcial, no un no-op.
      fail('strip-dev', `push falló tras actualizar ${target} localmente (estado parcial): ${(res.stderr || '').trim()}`, EXIT_CODES.PARCIAL);
    }
    console.log(`strip-dev: push OK -> ${opts.remote}/${target}`);
  }
}

if (isMain(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2));
}
