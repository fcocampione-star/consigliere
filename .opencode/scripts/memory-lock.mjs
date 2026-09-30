#!/usr/bin/env node
/**
 * Consigliere 2.0 (Advisor Harness) — memory-lock.mjs
 * Lock cross-platform para escrituras de memoria (md+grep), sin flock/perl/sed/date/grep externos.
 *
 * Contrato:
 *  - Dir de lock: `.memory-lock/` (raíz del proyecto);
 *    `owner.json` = {pid, host, ts, version, token}.
 *  - Adquirir = `mkdir` atómico (falla si existe). `acquire` genera un token
 *    aleatorio (16 bytes hex) y lo persiste en `owner.json`; el CLI lo emite en
 *    su salida JSON `{acquired:true, token, owner}`.
 *  - Takeover de lock stale = rename ATÓMICO del dir a `.memory-lock.stale.<pid>`
 *    (NUNCA rmdir+mkdir). Revalida staleness justo antes del rename y, tras mover
 *    el dir, lee el `owner.json` movido: si es fresco (otro proceso liberó el stale
 *    y adquirió) lo restaura best-effort a `.memory-lock/` y reporta `busy`
 *    (anti doble posesión). Si el rename de restauración falla, se loggea a
 *    stderr y el resultado lleva `restoreFailed:true` (best-effort pero visible).
 *  - Umbral stale default 300000 ms, override con env `ADVISOR_LOCK_STALE_MS`.
 *    `LOCK_STALE_MS` es la ÚNICA fuente del umbral (exportada; doctor la consume).
 *    El override se parsea ESTRICTAMENTE: solo un entero no negativo por encima de
 *    `MIN_STALE_MS` (1000 ms). Antes `Number()` aceptaba cualquier cosa que se
 *    pareciera a un número —`'  '` → 0, `'1e3'` → 1000, `'0x10'` → 16— y 0 (o casi
 *    0) DESACTIVABA la mutua exclusión en silencio: todo lock se declaraba stale al
 *    instante y cada acquire robaba el del otro. Valor inválido → aviso por stderr
 *    y umbral por defecto; env ausente o vacío → umbral por defecto, sin aviso.
 *  - Raíz del lock: la del repo del propio script, con override de env
 *    `ADVISOR_LOCK_ROOT` (TEST-ONLY) que mueve el lock y las rutas que cuelgan
 *    de la raíz (`.memory-lock`, dirs `.memory-lock.stale.*`). Un valor de solo
 *    espacios se trata como AUSENTE (igual que ''): `resolve('  ')` es el cwd, y
 *    el lock caería en un directorio arbitrario en vez de en la raíz del script.
 *  - `release` cross-proceso por TOKEN (uso multi-proceso: acquire y release son
 *    procesos distintos, así que `pid` no basta). Orden de resolución:
 *      1. `--token <t>` (o env `ADVISOR_LOCK_TOKEN`) === `owner.token` → libera
 *         (`reason:'token'`).
 *      2. sin token: `owner.pid===process.pid && owner.host===hostname` → libera
 *         (`reason:'owner'`, in-process).
 *      3. `--force` → libera un lock ajeno (`reason:'forced'`).
 *      4. si no → `{released:false, reason:'not-owner'}` (CLI exit 1).
 *    Para liberar en multi-proceso: guarda el token que devuelve `acquire` y
 *    pásalo a `release --token <t>` (o exporta `ADVISOR_LOCK_TOKEN`). `--force`
 *    sigue disponible. Sin `owner.json` o con `owner.json` corrupto NO se puede
 *    comprobar ni el token ni el pid+host, así que SOLO `--force` lo libera
 *    (`reason:'corrupt-owner'` / `'no-owner-file'`); sin `--force` devuelve
 *    `{released:false, ...}` con esos mismos motivos y el CLI dice qué hacer
 *    (antes cualquier llamante liberaba ese lock sin comprobación ninguna).
 *  - GC best-effort de dirs `.memory-lock.stale.*` con antigüedad > max(stale*2, 1h),
 *    ejecutado en acquire/release; `status` reporta cuántos hay.
 *  - Pureza cross-platform: solo node:fs / node:path / node:os / node:crypto.
 *  - v5: el entry point lo decide `isMain` de lib/core.mjs (el CLI no se ejecuta al
 *    importar el módulo, que memory-rotate y memory-sync hacen), y la raíz se sigue
 *    calculando aquí: es lo único que puede redirigir ADVISOR_LOCK_ROOT.
 *  - `owner.json` se escribe con writeFileSync porque nace en un directorio recién
 *    creado por `mkdir` atómico: no hay lector al que pisarle.
 *
 * Uso:
 *   node .opencode/scripts/memory-lock.mjs acquire            (exit 0 adquirido → JSON {acquired,token,owner}; 1 ocupado)
 *   node .opencode/scripts/memory-lock.mjs release [--token <t>] [--force]  (exit 0 liberado, 1 no-dueño)
 *   node .opencode/scripts/memory-lock.mjs status             (exit 0; imprime estado/owner)
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isMain } from './lib/core.mjs';

// Override de raíz SOLO para tests (fixtures sandbox): sin ADVISOR_LOCK_ROOT el
// lock queda fijado al repo del propio script, así que probarlo exigiría tocar
// su `.memory-lock` real. El env se lee UNA vez, aquí, al cargar el módulo.
// Un valor de solo espacios se trata como ausente: `resolve('  ')` devuelve el
// cwd, con lo que el lock aterrizaría en un directorio arbitrario en vez de en la
// raíz del script (el mismo tipo de fallo que un umbral en 0: silencioso y raro).
// El default NO es core.REPO_ROOT: ese se resuelve desde lib/ y cae en `.opencode/`.
function resolveRoot() {
  const raw = process.env.ADVISOR_LOCK_ROOT;
  if (raw === undefined || raw.trim() === '') return join(import.meta.dirname, '..', '..');
  if (raw !== raw.trim()) {
    console.error(`memory-lock: ADVISOR_LOCK_ROOT con espacios en los bordes se normaliza a ${JSON.stringify(raw.trim())}.`);
  }
  return resolve(raw.trim());
}
const ROOT = resolveRoot();
const LOCK_NAME = '.memory-lock';
const LOCK_DIR = join(ROOT, LOCK_NAME);
const OWNER_FILE = 'owner.json';
const LOCK_VERSION = 1;
const STALE_PREFIX = `${LOCK_NAME}.stale.`;
const GC_MIN_MS = 3600000; // 1h de suelo para el GC de dirs stale huérfanos

const DEFAULT_STALE_MS = 300000;
// Suelo del umbral: por debajo de 1 s el lock se declararía stale casi nada más
// adquirirlo y la mutua exclusión se desactivaría de facto (con 0, cualquier
// acquire se apropiaba del lock del otro al instante). Un umbral útil tiene que
// sobrevivir de sobra a una escritura de memoria (rotación/export/import).
export const MIN_STALE_MS = 1000;

// Parseo ESTRICTO del umbral: solo `^\d+$` (entero no negativo) y por encima del
// suelo. `Number()` era demasiado permisivo y hacía colapsar valores degenerados:
//   '  '   → 0   (solo espacios: mutua exclusión desactivada, sin aviso)
//   '0'    → 0   (desactiva la exclusión)
//   '1e3'  → 1000, '0x10' → 16, '1.0' → 1 (notaciones que no son un entero plain)
//   ''     → 0   (env vacío: se trata como ausente, sin aviso)
//   ' 1000 ' → 1000 (el trim es inocuo: se acepta como 1000)
//   'Infinity'/'1,5'/'50abc'/'-1' → NaN o negativo (ya caían al default)
// Se avisa por stderr y se vuelve al default cuando el valor no es válido.
function resolveStaleMs() {
  const raw = process.env.ADVISOR_LOCK_STALE_MS;
  if (raw === undefined || raw === '') return DEFAULT_STALE_MS; // sin override
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < MIN_STALE_MS) {
    console.error(`memory-lock: ADVISOR_LOCK_STALE_MS inválido (${JSON.stringify(raw)}); se usa el umbral por defecto ${DEFAULT_STALE_MS} ms (mínimo ${MIN_STALE_MS} ms).`);
    return DEFAULT_STALE_MS;
  }
  return Number(trimmed);
}
export const LOCK_STALE_MS = resolveStaleMs();
const GC_STALE_MS = Math.max(LOCK_STALE_MS * 2, GC_MIN_MS);

export function lockPath() { return LOCK_DIR; }

export function readOwner() {
  return readOwnerAt(LOCK_DIR);
}

function readOwnerAt(dir) {
  try { return JSON.parse(readFileSync(join(dir, OWNER_FILE), 'utf8')); }
  catch { return null; }
}

// Edad de un dir de lock: ts de su owner.json si es válido; si no, mtime del dir.
// El rename preserva el mtime del dir, así que tras el takeover sigue siendo válido.
// Exportada: doctor la consume para medir orfandad con la MISMA noción de edad.
export function dirAgeMs(dir, now = Date.now()) {
  const owner = readOwnerAt(dir);
  let ts = owner && Number.isFinite(owner.ts) ? owner.ts : null;
  if (ts === null) ts = statSync(dir).mtimeMs;
  return now - ts;
}

function lockAgeMs(now = Date.now()) {
  return dirAgeMs(LOCK_DIR, now);
}

export function isStale(now = Date.now()) {
  try { return lockAgeMs(now) > LOCK_STALE_MS; }
  catch { return false; }
}

// Dir(s) `.memory-lock.stale.*` presentes en la raíz (sin tocar nada).
export function listStaleDirs() {
  try { return readdirSync(ROOT).filter((n) => n.startsWith(STALE_PREFIX)); }
  catch { return []; }
}

// GC best-effort: borra dirs de takeover huérfanos más viejos que GC_STALE_MS.
// Nunca lanza y nunca afecta al lock vivo (umbral amplio para una carrera en curso).
export function gcStaleDirs(now = Date.now()) {
  let removed = 0;
  for (const n of listStaleDirs()) {
    const p = join(ROOT, n);
    try {
      if (dirAgeMs(p, now) > GC_STALE_MS) { rmSync(p, { recursive: true, force: true }); removed++; }
    } catch { /* best-effort */ }
  }
  return removed;
}

// Takeover por rename atómico, con doble verificación anti doble posesión.
// Destino `.memory-lock.stale.<pid>`; si ya existe (pid repetido), sufija para no
// colisionar (sigue siendo rename).
function takeoverStale() {
  if (!isStale()) return { taken: false, reason: 'busy' }; // revalidación pre-rename
  const target = join(ROOT, `${LOCK_NAME}.stale.${process.pid}`);
  let dest = target;
  let i = 1;
  while (existsSync(dest)) dest = `${target}.${i++}`;
  try { renameSync(LOCK_DIR, dest); }
  catch (e) { return { taken: false, reason: e.code === 'ENOENT' ? 'busy' : 'error', error: e.message }; }
  // Post-rename: si el owner movido resultó fresco, otro proceso ganó la carrera
  // (liberó el stale y adquirió); restaurar best-effort y reportar busy.
  const owner = readOwnerAt(dest);
  let movedAge = null;
  try { movedAge = dirAgeMs(dest); } catch { movedAge = null; }
  if (movedAge !== null && movedAge <= LOCK_STALE_MS) {
    // Restauración best-effort pero VISIBLE: si falla, un owner fresco queda
    // desposeído sin lock; loggeamos a stderr y marcamos restoreFailed.
    let restoreFailed = false;
    try { renameSync(dest, LOCK_DIR); } catch { restoreFailed = true; }
    if (restoreFailed) {
      console.error('memory-lock: restore failed; a fresh lock could not be restored');
      return { taken: false, reason: 'busy', owner, restoreFailed: true };
    }
    return { taken: false, reason: 'busy', owner };
  }
  return { taken: true, moved: dest };
}

export function acquireLock() {
  gcStaleDirs();
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      mkdirSync(LOCK_DIR); // atómico: EEXIST si ya está tomado
    } catch (e) {
      if (e.code !== 'EEXIST') return { acquired: false, reason: 'error', error: e.message };
      if (!isStale()) return { acquired: false, reason: 'busy', owner: readOwner() };
      const t = takeoverStale();
      if (t.reason === 'error') return { acquired: false, reason: 'error', error: t.error };
      if (!t.taken) return {
        acquired: false,
        reason: 'busy',
        owner: t.owner ?? readOwner(),
        ...(t.restoreFailed ? { restoreFailed: true } : {}),
      };
      continue;
    }
    const token = randomBytes(16).toString('hex');
    const owner = { pid: process.pid, host: hostname(), ts: Date.now(), version: LOCK_VERSION, token };
    try {
      writeFileSync(join(LOCK_DIR, OWNER_FILE), JSON.stringify(owner, null, 2) + '\n');
    } catch (e) {
      try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
      return { acquired: false, reason: 'error', error: e.message };
    }
    return { acquired: true, token, owner };
  }
  return { acquired: false, reason: 'busy', owner: readOwner() };
}

export function releaseLock({ force = false, token = null } = {}) {
  gcStaleDirs();
  if (!existsSync(LOCK_DIR)) return { released: true, reason: 'free' };
  const ownerPath = join(LOCK_DIR, OWNER_FILE);
  const hasOwnerFile = existsSync(ownerPath);
  const owner = hasOwnerFile ? readOwner() : null;
  if (!hasOwnerFile || owner === null) {
    // Sin dueño legible NO hay token ni pid+host que comprobar, así que liberar
    // aquí era un `rm -rf` de cualquiera: cualquier proceso (o el `finally` de otro
    // escritor) desposeía un lock ajeno o ya liberado a medias. Solo la ruta
    // documentada `--force` lo hace; sin ella se devuelve `released:false` con el
    // motivo (el CLI lo traduce a un mensaje accionable y exit 1).
    const reason = hasOwnerFile ? 'corrupt-owner' : 'no-owner-file';
    if (!force) return { released: false, reason, owner: null };
    return finishRelease({ reason });
  }
  const providedToken = token ?? process.env.ADVISOR_LOCK_TOKEN ?? null;
  if (providedToken !== null && owner.token !== undefined && providedToken === owner.token) {
    return finishRelease({ reason: 'token' });
  }
  const isOwner = owner.pid === process.pid && owner.host === hostname();
  if (isOwner) return finishRelease({ reason: 'owner' });
  if (!force) return { released: false, reason: 'not-owner', owner };
  return finishRelease({ reason: 'forced', owner });
}

function finishRelease(extra) {
  try { rmSync(join(LOCK_DIR, OWNER_FILE), { force: true }); } catch { /* idempotente */ }
  try { if (existsSync(LOCK_DIR)) rmSync(LOCK_DIR, { recursive: true, force: true }); }
  catch (e) { return { released: false, reason: 'error', error: e.message, ...extra }; }
  return { released: true, ...extra };
}

export function lockStatus() {
  const staleDirs = listStaleDirs().length;
  if (!existsSync(LOCK_DIR)) return { held: false, staleDirs };
  const owner = readOwner();
  let ageMs = null;
  try { ageMs = lockAgeMs(); } catch { ageMs = null; }
  return {
    held: true,
    stale: ageMs === null ? null : ageMs > LOCK_STALE_MS,
    ageMs,
    owner,
    staleDirs,
    path: LOCK_DIR,
  };
}

function parseTokenArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--token') return argv[i + 1] ?? null;
    if (a.startsWith('--token=')) return a.slice('--token='.length);
  }
  return null;
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'acquire': {
      const r = acquireLock();
      if (r.acquired) {
        console.log(JSON.stringify({ acquired: true, token: r.token, owner: r.owner }));
        process.exit(0);
      }
      console.error(`lock busy: ${r.reason}${r.owner ? ` (holder pid ${r.owner.pid})` : ''}${r.restoreFailed ? ' [restore failed]' : ''}`);
      process.exit(1);
      break;
    }
    case 'release': {
      const force = process.argv.includes('--force');
      const token = parseTokenArg(process.argv.slice(3));
      const r = releaseLock({ force, token });
      if (r.released) {
        console.log(`lock released${r.reason && r.reason !== 'owner' ? ` (${r.reason})` : ''}`);
        process.exit(0);
      }
      if (r.reason === 'not-owner') {
        console.error(`release refused: not-owner (holder pid ${r.owner?.pid}, host ${r.owner?.host}) — usa --token <t> o --force`);
        process.exit(1);
      }
      if (r.reason === 'no-owner-file' || r.reason === 'corrupt-owner') {
        const detalle = r.reason === 'no-owner-file' ? 'no hay owner.json' : 'owner.json ilegible';
        console.error(`release refused: ${r.reason} (${detalle}; no se puede comprobar token ni pid+host) — usa --force para liberarlo`);
        process.exit(1);
      }
      console.error(`release failed: ${r.error || r.reason}`);
      process.exit(1);
      break;
    }
    case 'status': {
      const s = lockStatus();
      if (!s.held) { console.log(s.staleDirs ? `free (staleDirs ${s.staleDirs})` : 'free'); process.exit(0); }
      console.log(JSON.stringify(s, null, 2));
      process.exit(0);
      break;
    }
    default: {
      // El uso sin comando sigue por STDOUT (core.exitUsage iría a stderr: cambio
      // observable) y los errores de acquire/release no pasan por core.fail porque
      // su texto (`lock busy: …`, `release refused: …`) es contrato de la suite.
      console.log(`Uso:
  node .opencode/scripts/memory-lock.mjs acquire                                   (exit 0 adquirido → JSON {acquired,token,owner}; 1 ocupado)
  node .opencode/scripts/memory-lock.mjs release [--token <t>] [--force]          (exit 0 liberado, 1 no-dueño)
  node .opencode/scripts/memory-lock.mjs status`);
      process.exit(1);
    }
  }
}

if (isMain(import.meta.url, process.argv[1])) main();

export { LOCK_NAME, LOCK_DIR, OWNER_FILE, DEFAULT_STALE_MS, takeoverStale };
