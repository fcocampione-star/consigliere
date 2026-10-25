#!/usr/bin/env node
/**
 * Consigliere 1.0 (Advisor Harness) — git-state.mjs
 * Trámites de rama de SOLO LECTURA para el advisor: estado, log corto, HEAD,
 * rama actual, diff --stat, ahead/behind del upstream y remotos.
 *
 * Por qué existe: el advisor no recibe `git` crudo (ni `glob`/`grep`). Con una
 * allowlist de bash de entradas EXACTAS, la única forma de que resuelva "¿en qué
 * rama estoy / cuántos commits llevo sin subir?" sin abrir shell es un script
 * con argv CERRADO: el usuario elige un subcomando de una tabla congelada y
 * NUNCA aporta argumentos libres ni refs. `shell: false` siempre.
 *
 * Defensa en profundidad (dos puertas, ambas antes de spawnear):
 *  1. Cero argumentos libres: cualquier token extra es error de uso (exit 1).
 *  2. Todo elemento del argv debe casar /^[\w@{}./:~^=-]+$/ y ningún elemento
 *     que venga del usuario puede empezar por `-` (bloquea `--output=`,
 *     `--exec`, `--upload-pack`). Los únicos tokens con `-` son los flags
 *     literales de la tabla de abajo, que no son datos del usuario.
 * Si algo no casa: exit 1 SIN spawn (nada de "git interpreta lo que sea").
 *
 * Binario: `ADVISOR_GIT` (override explícito) -> PATH (con PATHEXT en win32).
 * Resolución memoizada, igual que `ADVISOR_BASH`/`ADVISOR_TAR`. Sin binario:
 * exit 3 (DEPENDENCIA).
 *
 * Salida: se recorta a MAX_LINES líneas (sufijo `… (truncated)`), porque esto
 * alimenta la ventana de un coordinador: un `git log` de 500 líneas no es
 * información, es ruido. `ahead-behind` NO hace fetch: declara su propia
 * limitación en la salida (una ref remota stale puede mentir).
 *
 * Uso:
 *   node .opencode/scripts/git-state.mjs <subcomando>
 *
 * Exit: 0 ok · 1 uso/argv inválido · 3 git ausente · 5 git falló.
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { EXIT_CODES, exitUsage, fail, isMain } from './lib/core.mjs';

// ── Contrato (exportado para los tests) ──────────────────────────────────────

/** Tope de líneas de salida (una por línea, sin contar el sufijo de recorte). */
export const MAX_LINES = 40;
/** Tope de bytes de stdout/stderr que se le piden a git. */
export const MAX_BUFFER = 128 * 1024;
/** Único vocabulario aceptable en un elemento de argv. */
export const ARGV_ELEMENT_RE = /^[\w@{}./:~^=-]+$/;
/** Línea que `ahead-behind` añade SIEMPRE: sin fetch, las refs pueden estar stale. */
export const NO_FETCH_NOTE = '(sin fetch: refs de la última sincronización — pueden estar stale)';

/**
 * Tabla CERRADA subcomando -> argv fijo de git. Nada de lo que escribe el
 * usuario llega aquí: si quieres otro trámite, se añade una entrada nueva.
 */
export const SUBCOMMANDS = Object.freeze({
  status: Object.freeze(['status', '--short', '--branch']),
  log: Object.freeze(['log', '--oneline', '-n', '20']),
  head: Object.freeze(['rev-parse', '--short', 'HEAD']),
  branch: Object.freeze(['branch', '--show-current']),
  'diff-stat': Object.freeze(['diff', '--stat']),
  'ahead-behind': Object.freeze(['rev-list', '--left-right', '--count', '@{u}...HEAD']),
  remote: Object.freeze(['remote', '-v']),
});

export const SUBCOMMAND_NAMES = Object.freeze(Object.keys(SUBCOMMANDS));

const USO = `Uso:
  node .opencode/scripts/git-state.mjs <subcomando>

Subcomandos (solo lectura; sin argumentos libres ni refs):
  status         git status --short --branch
  log            git log --oneline -n 20
  head           git rev-parse --short HEAD
  branch         git branch --show-current
  diff-stat      git diff --stat
  ahead-behind   git rev-list --left-right --count @{u}...HEAD (NO hace fetch)
  remote         git remote -v
  --help, -h     esta ayuda

Salida recortada a ${MAX_LINES} líneas. Binario: ADVISOR_GIT o PATH.
Exit: 0 ok, 1 uso/argv inválido, 3 git ausente, 5 git falló.`;

/**
 * ¿Esto es un elemento de argv que git puede recibir sin sorpresas? Solo
 * caracteres "de ruta/ref" (sin espacios, comillas, `;`, `&`, `|`, `$`, `>`…).
 */
export function isSafeElement(value) {
  return typeof value === 'string' && value !== '' && ARGV_ELEMENT_RE.test(value);
}

/**
 * ¿Puede un token VENIR DEL USUARIO? Además de la regex, nada que empiece por
 * `-`: un flag de git elegido por el usuario es exactamente lo que se prohíbe
 * (`--output=`, `--exec`, `--upload-pack`, `--git-dir`…).
 */
export function isSafeUserElement(value) {
  return isSafeElement(value) && !value.startsWith('-');
}

/**
 * Auditoría del argv fijo: devuelve el primer elemento inválido o `null`.
 * Los flags literales empiezan por `-` a propósito (son de la tabla, no del
 * usuario); cualquier OTRO elemento con `-` delante se considera violación.
 */
export function auditArgv(argv) {
  if (!Array.isArray(argv)) return '(argv no es una lista)';
  const literals = new Set();
  for (const fixed of Object.values(SUBCOMMANDS)) {
    for (const a of fixed) if (a.startsWith('-')) literals.add(a);
  }
  for (const a of argv) {
    if (!isSafeElement(a)) return a;
    if (a.startsWith('-') && !literals.has(a)) return a;
  }
  return null;
}

/** Recorta una salida a MAX_LINES líneas; si sobra, cierra con el sufijo. */
export function trimOutput(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return '';
  if (lines.length <= MAX_LINES) return lines.join('\n');
  return [...lines.slice(0, MAX_LINES), '… (truncated)'].join('\n');
}

// ── Resolución del binario git ───────────────────────────────────────────────

let gitBin;
let gitResolved = false;

/**
 * Ruta del binario git: `ADVISOR_GIT` (override explícito) -> PATH (con PATHEXT
 * en win32). Memoizada; `null` si no aparece.
 */
export function resolveGit() {
  if (gitResolved) return gitBin;
  gitResolved = true;
  const override = (process.env.ADVISOR_GIT || '').trim();
  if (override) {
    gitBin = override;
    return gitBin;
  }
  // En win32 el ejecutable del PATH puede no llevar extensión implícita: hay
  // que probar cada PATHEXT (git.exe/git.cmd).
  const exts = process.platform === 'win32'
    ? ['', ...String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  for (const dir of String(process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `git${ext}`);
      if (!existsSync(candidate)) continue;
      try { accessSync(candidate, constants.X_OK); } catch { continue; }
      gitBin = candidate;
      return gitBin;
    }
  }
  gitBin = null;
  return null;
}

// ── Ejecución ───────────────────────────────────────────────────────────────

function runGit(sub, fixed) {
  const offender = auditArgv(fixed);
  // Inalcanzable salvo bug de la tabla; si pasara, se corta ANTES del spawn.
  if (offender !== null) fail('git-state', `argv inválido en la tabla (${sub}): "${offender}"`);
  const bin = resolveGit();
  if (!bin) {
    fail(
      'git-state',
      'no se encontró el binario "git" (ni ADVISOR_GIT ni en PATH). Instala git o define ADVISOR_GIT con su ruta.',
      EXIT_CODES.DEPENDENCIA,
    );
  }
  const res = spawnSync(bin, fixed, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: 15000,
    shell: false,
    windowsHide: true,
  });
  if (res.error && res.error.code === 'ENOENT') {
    fail('git-state', `no se pudo ejecutar "${bin}": ${res.error.message}`, EXIT_CODES.DEPENDENCIA);
  }
  if (res.error) {
    fail('git-state', `git ${sub} no se pudo ejecutar: ${res.error.message}`, EXIT_CODES.PARCIAL);
  }
  if (res.status !== 0) {
    // stderr recortado (mismo tope que stdout): el motivo accionable de git.
    const why = trimOutput(res.stderr) || trimOutput(res.stdout) || `exit ${res.status}`;
    console.error(`git-state: git ${sub} falló (exit ${res.status}):\n${why}`);
    process.exit(EXIT_CODES.PARCIAL);
  }
  const out = trimOutput(res.stdout);
  if (out) console.log(out);
  if (sub === 'ahead-behind') console.log(NO_FETCH_NOTE);
}

function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  if (sub === '--help' || sub === '-h') {
    console.log(USO);
    return;
  }
  if (!sub) exitUsage(USO);
  if (!Object.prototype.hasOwnProperty.call(SUBCOMMANDS, sub)) {
    exitUsage(`git-state: subcomando desconocido "${sub}" (los subcomandos son cerrados).\n\n${USO}`);
  }
  const extra = argv.slice(1);
  if (extra.length > 0) {
    const bad = extra[0];
    const why = !isSafeElement(bad)
      ? 'contiene caracteres no permitidos'
      : bad.startsWith('-')
        ? 'empieza por "-" (no se aceptan flags)'
        : 'es un argumento libre';
    exitUsage(`git-state: argumento rechazado "${bad}": ${why}. Los subcomandos no llevan argumentos.\n\n${USO}`);
  }
  runGit(sub, SUBCOMMANDS[sub]);
}

if (isMain(import.meta.url, process.argv[1])) main();
