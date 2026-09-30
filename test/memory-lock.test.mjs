/**
 * test/memory-lock.test.mjs — caracterizacion del lock cross-platform.
 *
 * Cubre `.opencode/scripts/memory-lock.mjs`:
 *  - Aislamiento: `ADVISOR_LOCK_ROOT` se lee UNA vez al cargar el modulo, asi que
 *    cada test carga su propia instancia con un import dinamico (`?t=N`) DESPUES
 *    de fijar el env, y cada instancia recibe su propio `tmpdir()`. El
 *    `.memory-lock` real del repo no se toca nunca.
 *  - `acquireLock` / `releaseLock` / `lockStatus` / `dirAgeMs` / `isStale` /
 *    `listStaleDirs` / `gcStaleDirs` / `takeoverStale`.
 *  - Umbral stale: `ADVISOR_LOCK_STALE_MS` (solo entero >= MIN_STALE_MS; basura,
 *    negativos, cero y notaciones ambiguas caen al default CON aviso) y
 *    `ADVISOR_LOCK_ROOT` (un valor de solo espacios se trata como ausente).
 *  - Release por token: parametro y variable de entorno `ADVISOR_LOCK_TOKEN`.
 *  - Release sin dueño legible (owner.json ausente o corrupto): se NIEGA salvo
 *    `--force`.
 *  - Takeover de un lock stale: exito, restauracion del owner fresco, restauracion
 *    fallida (`restoreFailed`) y carrera perdida.
 *
 * Inyeccion de reloj: `takeoverStale` comprueba la edad ANTES y DESPUES del rename
 * con `Date.now()`. Como la edad solo puede crecer, la rama "el owner movido salio
 * fresco" es inalcanzable con el reloj real; `withFakeNow` inyecta una secuencia
 * de valores para reproducirla de forma determinista. Solo sustituye `Date.now`
 * durante la llamada y lo restaura siempre.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, eq, neq, match, includes, throws, tmpdir, cleanup, runAll } from './harness.mjs';

const MODULE = '../.opencode/scripts/memory-lock.mjs';
const MODULE_ABS = fileURLToPath(new URL(MODULE, import.meta.url)); // para los tests de CLI
const LOCK = '.memory-lock';
const STALE_PREFIX = `${LOCK}.stale.`;
const HORA = 3600000;
const BASE = 1800000000000; // reloj fijo para las edades deterministas
const REPO_RAIZ = fileURLToPath(new URL('..', import.meta.url)); // raiz del repo (solo comparacion)

// Sandboxes creados por los tests; el ultimo test verifica que ninguno conserva
// escombros de lock.
const sandboxes = [];

function sandbox(prefix) {
  const root = tmpdir(prefix);
  sandboxes.push(root);
  return root;
}

// ── Utilidades locales ───────────────────────────────────────────────────────
// Carga una instancia fresca del modulo con la raiz y el umbral indicados. El
// env se fija ANTES del import porque el modulo lo lee al evaluarse, y se
// restaura despues para no contaminar el resto de la suite.
let instancias = 0;
async function cargarLock({ root, staleMs } = {}) {
  const prevRoot = process.env.ADVISOR_LOCK_ROOT;
  const prevStale = process.env.ADVISOR_LOCK_STALE_MS;
  if (root === undefined) delete process.env.ADVISOR_LOCK_ROOT;
  else process.env.ADVISOR_LOCK_ROOT = root;
  if (staleMs === undefined) delete process.env.ADVISOR_LOCK_STALE_MS;
  else process.env.ADVISOR_LOCK_STALE_MS = staleMs;
  try {
    return await import(`${MODULE}?t=${instancias++}`);
  } finally {
    if (prevRoot === undefined) delete process.env.ADVISOR_LOCK_ROOT;
    else process.env.ADVISOR_LOCK_ROOT = prevRoot;
    if (prevStale === undefined) delete process.env.ADVISOR_LOCK_STALE_MS;
    else process.env.ADVISOR_LOCK_STALE_MS = prevStale;
  }
}

// Sandbox dedicado a una sola instancia del modulo (la que usa el test).
async function conLock(prefix, opciones = {}) {
  const root = sandbox(prefix);
  const mod = await cargarLock({ ...opciones, root });
  return { root, mod, lockDir: join(root, LOCK) };
}

// Igual que conLock, pero captura el stderr de la CARGA del modulo: los avisos de
// env invalido se emiten al evaluarse el modulo (una vez por instancia), asi que el
// espia tiene que estar puesto ANTES del `import`.
async function conLockCapturandoStderr(prefix, opciones = {}) {
  const lineas = [];
  const real = console.error;
  console.error = (...args) => { lineas.push(args.map(String).join(' ')); };
  try {
    return { ...(await conLock(prefix, opciones)), stderr: lineas };
  } finally {
    console.error = real;
  }
}

// Corre el CLI del lock contra un sandbox (ADVISOR_LOCK_ROOT lo aísla del repo).
function cli(root, args) {
  return spawnSync(process.execPath, [MODULE_ABS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ADVISOR_LOCK_ROOT: root, ADVISOR_LOCK_STALE_MS: '' },
  });
}

function crearLock(root, owner) {
  const dir = join(root, LOCK);
  mkdirSync(dir, { recursive: true });
  if (owner !== undefined) {
    writeFileSync(join(dir, 'owner.json'), typeof owner === 'string' ? owner : `${JSON.stringify(owner, null, 2)}\n`);
  }
  return dir;
}

function crearStale(root, nombre, ts) {
  const dir = join(root, `${STALE_PREFIX}${nombre}`);
  mkdirSync(dir, { recursive: true });
  if (ts !== undefined) writeFileSync(join(dir, 'owner.json'), `${JSON.stringify({ ts }, null, 2)}\n`);
  return dir;
}

function leerOwnerJson(dir) {
  return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
}

// Reloj inyectado: cada posicion de `secuencia` es el valor de Date.now() de esa
// llamada (o una funcion que lo devuelve y de paso prepara el escenario). `fn`
// debe ser SINCRONA: el reloj real se restaura en cuanto termina.
function withFakeNow(secuencia, fn) {
  const real = Date.now;
  let i = 0;
  Date.now = () => {
    const paso = secuencia[Math.min(i, secuencia.length - 1)];
    i++;
    return typeof paso === 'function' ? paso() : paso;
  };
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

// Captura lo que el modulo escribe en stderr (restauracion fallida).
function capturandoStderr(fn) {
  const lineas = [];
  const real = console.error;
  console.error = (...args) => { lineas.push(args.map(String).join(' ')); };
  try {
    return { resultado: fn(), stderr: lineas };
  } finally {
    console.error = real;
  }
}

// ── Raiz y umbral ───────────────────────────────────────────────────────────
suite('memory-lock raíz y umbral');

test('ADVISOR_LOCK_ROOT mueve el lock al sandbox (lockPath y constantes)', async () => {
  const { root, mod } = await conLock('advisor-lock-raiz');
  assert(mod.lockPath() === join(root, LOCK), 'lockPath cuelga de la raiz del sandbox');
  eq(mod.LOCK_NAME, LOCK, 'nombre del lock');
  eq(mod.OWNER_FILE, 'owner.json', 'nombre del fichero de dueno');
  assert(mod.lockPath().startsWith(root), 'el lock vive dentro del sandbox');
  neq(mod.lockPath(), join(REPO_RAIZ, LOCK), 'nunca en el .memory-lock del repo');
});

test('ADVISOR_LOCK_ROOT vacio significa raiz del repo (sin override)', async () => {
  // Solo se compara una cadena: con esta instancia NO se llama a ninguna funcion
  // que escriba, para no tocar el .memory-lock real del repo.
  const mod = await cargarLock({ root: '' });
  eq(mod.lockPath(), join(REPO_RAIZ, LOCK), 'env vacio -> raiz del propio script');
});

test('umbral por defecto: 300000 ms cuando no hay env', async () => {
  const mod = await cargarLock({ root: sandbox('advisor-lock-umbral') });
  eq(mod.DEFAULT_STALE_MS, 300000, 'DEFAULT_STALE_MS exportado');
  eq(mod.LOCK_STALE_MS, 300000, 'sin env se usa el default');
  eq(mod.MIN_STALE_MS, 1000, 'MIN_STALE_MS exportado: suelo de 1 s (por debajo el lock se roba solo)');
});

test('ADVISOR_LOCK_STALE_MS: se respeta un entero >= MIN_STALE_MS', async () => {
  const mod1 = await cargarLock({ root: sandbox('advisor-lock-umbral'), staleMs: '1000' });
  eq(mod1.LOCK_STALE_MS, 1000, '1000 ms (justo el suelo)');
  const mod2 = await cargarLock({ root: sandbox('advisor-lock-umbral'), staleMs: '45000' });
  eq(mod2.LOCK_STALE_MS, 45000, '45000 ms');
  const modEspacios = await cargarLock({ root: sandbox('advisor-lock-umbral'), staleMs: ' 2000 ' });
  eq(modEspacios.LOCK_STALE_MS, 2000, 'espacios alrededor de un entero valido se recortan');
  const modVacio = await cargarLock({ root: sandbox('advisor-lock-umbral'), staleMs: '' });
  eq(modVacio.LOCK_STALE_MS, 300000, 'env vacio -> default (sin override)');
});

test('ADVISOR_LOCK_STALE_MS: 0 ya NO se acepta (desactivaba la exclusion mutua en silencio)', async () => {
  // Antes: Number('0') = 0 >= 0 -> umbral 0 -> cualquier lock es stale al instante
  // y cada acquire se apropiaba del del otro, sin un solo aviso.
  const { mod, stderr } = await conLockCapturandoStderr('advisor-lock-umbral', { staleMs: '0' });
  eq(mod.LOCK_STALE_MS, 300000, '0 cae al umbral por defecto');
  eq(stderr.length, 1, 'y avisa por stderr en vez de fallar en silencio');
  match(stderr[0], /ADVISOR_LOCK_STALE_MS inválido \("0"\)/, 'el aviso cita el valor recibido');
  match(stderr[0], /300000 ms/, 'y dice que umbral se aplica');
  try {
    eq(mod.acquireLock().acquired, true, 'primer acquire');
    eq(mod.acquireLock().acquired, false, 'el segundo NO se apropia del lock ajeno (mutua exclusion viva)');
  } finally {
    mod.releaseLock({ force: true });
    cleanup([mod.lockPath()]);
  }
});

test('notaciones ambiguas del umbral (1e3, 0x10) caen al default con aviso', async () => {
  for (const bruto of ['1e3', '0x10', ' 999 ', '007', '1.0']) {
    const { mod, stderr } = await conLockCapturandoStderr('advisor-lock-umbral', { staleMs: bruto });
    eq(mod.LOCK_STALE_MS, 300000, `env=${JSON.stringify(bruto)} -> default (no entero plano >= minimo)`);
    eq(stderr.length, 1, `env=${JSON.stringify(bruto)} -> un aviso`);
  }
});

test('valores no numericos o negativos caen al umbral por defecto (con aviso)', async () => {
  for (const bruto of ['abc', '50abc', '-1', 'Infinity', 'NaN', '1,5']) {
    const { mod, stderr } = await conLockCapturandoStderr('advisor-lock-umbral', { staleMs: bruto });
    eq(mod.LOCK_STALE_MS, 300000, `env=${JSON.stringify(bruto)} -> default`);
    eq(stderr.length, 1, `env=${JSON.stringify(bruto)} -> un aviso por stderr`);
    match(stderr[0], /ADVISOR_LOCK_STALE_MS inválido/, 'el aviso nombra la variable');
  }
});

test('ADVISOR_LOCK_STALE_MS de solo espacios: antes 0, ahora default + aviso', async () => {
  // Number('  ') === 0 y 0 >= 0, así que el umbral quedaba en 0 (cualquier lock es
  // "stale") sin avisar: la exclusion mutua quedaba desactivada por un env typo.
  const { root, mod, lockDir, stderr } = await conLockCapturandoStderr('advisor-lock-espacios', { staleMs: '  ' });
  try {
    eq(mod.LOCK_STALE_MS, 300000, 'solo espacios ya no colapsa a 0: cae al umbral por defecto');
    eq(stderr.length, 1, 'y avisa por stderr en vez de fallar en silencio');
    match(stderr[0], /inválido \(" {2}"\)/, 'el aviso cita el valor recibido, espacios incluidos');
    // Efecto practico: un lock recien tomado NO es stale y el segundo acquire busy.
    eq(mod.acquireLock().acquired, true, 'primer acquire');
    assert(!mod.isStale(), 'el lock propio no es stale con un umbral sano');
    eq(mod.acquireLock().acquired, false, 'el segundo acquire no roba el lock');
    assert(existsSync(lockDir), 'el lock sigue en su sitio');
    cleanup([root]);
  } finally {
    cleanup([root]);
  }
});

test('ADVISOR_LOCK_ROOT de solo espacios se trata como ausente (no como el cwd)', async () => {
  // Mismo tipo de fallo que un umbral en 0: resolve('  ') es el cwd, asi que el lock
  // caeria en un directorio arbitrario en vez de en la raiz del script.
  const mod = await cargarLock({ root: '  ' });
  eq(mod.lockPath(), join(REPO_RAIZ, LOCK), 'solo espacios -> raiz del propio script (como "")');
});

// ── acquire / release ───────────────────────────────────────────────────────
suite('memory-lock acquire/release');

test('acquire crea el dir y owner.json con token propio de 16 bytes hex', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-acquire');
  try {
    const r = mod.acquireLock();
    eq(r.acquired, true, 'adquirido');
    match(r.token, /^[0-9a-f]{32}$/, 'token de 16 bytes en hex');
    eq(r.owner.pid, process.pid, 'pid del proceso actual');
    eq(r.owner.host, hostname(), 'host del proceso actual');
    eq(r.owner.version, 1, 'version del lock');
    eq(r.owner.token, r.token, 'el owner guarda el mismo token');
    assert(typeof r.owner.ts === 'number' && r.owner.ts > 0, 'ts numerico');
    assert(existsSync(lockDir), 'dir del lock creado');
    eq(leerOwnerJson(lockDir), r.owner, 'owner.json coincide con el owner devuelto');
    eq(readdirSync(root), [LOCK], 'la raiz solo contiene el lock');
  } finally {
    cleanup([root]);
  }
});

test('un segundo acquire devuelve busy con el owner actual', async () => {
  const { root, mod } = await conLock('advisor-lock-busy');
  try {
    const a = mod.acquireLock();
    const b = mod.acquireLock();
    eq(b.acquired, false, 'no se puede adquirir dos veces');
    eq(b.reason, 'busy', 'motivo busy');
    eq(b.owner.token, a.token, 'informa del token del holder');
    eq(readdirSync(root), [LOCK], 'no se crea ningun dir extra');
  } finally {
    cleanup([root]);
  }
});

test('acquire con la raiz occupada por un fichero devuelve error (no EEXIST)', async () => {
  const parent = sandbox('advisor-lock-error');
  try {
    // La raiz del lock es un FICHERO: mkdir('.memory-lock') falla con ENOTDIR
    // (POSIX) o ENOENT (Windows), que no es EEXIST -> el motor reporta error.
    const raiz = join(parent, 'raiz');
    writeFileSync(raiz, 'bloquea la raiz\n');
    const mod = await cargarLock({ root: raiz });
    const r = mod.acquireLock();
    eq(r.acquired, false, 'no adquirido');
    eq(r.reason, 'error', 'motivo error (no busy)');
    match(r.error, /ENOENT|ENOTDIR/, 'propaga el codigo del sistema de ficheros');
    eq(mod.lockStatus().held, false, 'no queda ningun lock');
  } finally {
    cleanup([parent]);
  }
});

test('release sin token libera por owner (in-process) y borra el dir', async () => {
  const { mod, lockDir } = await conLock('advisor-lock-release-owner');
  try {
    mod.acquireLock();
    eq(mod.releaseLock(), { released: true, reason: 'owner' }, 'liberado por pid+host');
    assert(!existsSync(lockDir), 'el dir del lock desaparece');
    assert(!existsSync(join(lockDir, 'owner.json')), 'owner.json desaparece con el dir');
  } finally {
    cleanup([lockDir]);
  }
});

test('release de un lock ausente es idempotente (free)', async () => {
  const { mod, root } = await conLock('advisor-lock-release-libre');
  try {
    eq(mod.releaseLock(), { released: true, reason: 'free' }, 'no hay nada que liberar');
    eq(mod.releaseLock({ force: true }), { released: true, reason: 'free' }, 'tambien con force');
  } finally {
    cleanup([root]);
  }
});

test('release de un lock ajeno sin token se niega (not-owner) y no borra nada', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-ajeno');
  const dueno = { pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'tok-ajeno' };
  try {
    crearLock(root, dueno);
    eq(mod.releaseLock(), { released: false, reason: 'not-owner', owner: dueno }, 'se niega y devuelve el owner');
    assert(existsSync(lockDir), 'el lock ajeno sigue en pie');
    eq(leerOwnerJson(lockDir), dueno, 'owner.json intacto');
  } finally {
    cleanup([root]);
  }
});

test('release con el token correcto de un lock ajeno libera (razon token)', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-token');
  try {
    crearLock(root, { pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'tok-ajeno' });
    eq(mod.releaseLock({ token: 'tok-ajeno' }), { released: true, reason: 'token' }, 'liberado por token');
    assert(!existsSync(lockDir), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

test('ADVISOR_LOCK_TOKEN del entorno libera un lock ajeno', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-env-token');
  try {
    crearLock(root, { pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'tok-env' });
    process.env.ADVISOR_LOCK_TOKEN = 'tok-env';
    try {
      eq(mod.releaseLock(), { released: true, reason: 'token' }, 'el env aporta el token');
    } finally {
      delete process.env.ADVISOR_LOCK_TOKEN;
    }
    assert(!existsSync(lockDir), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

test('el token explicito tiene prioridad sobre el del entorno', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-token-prio');
  try {
    crearLock(root, { pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'tok-bueno' });
    process.env.ADVISOR_LOCK_TOKEN = 'tok-malo';
    try {
      eq(mod.releaseLock({ token: 'tok-bueno' }), { released: true, reason: 'token' }, 'gana el parametro');
    } finally {
      delete process.env.ADVISOR_LOCK_TOKEN;
    }
    assert(!existsSync(lockDir), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

test('caracterizacion: un token equivocado NO protege un lock del propio proceso', async () => {
  // Orden de resolucion: token -> pid+host -> force. Como el owner coincide con
  // este proceso, un token que no casa cae en la rama "owner" y libera igual.
  const { root, mod } = await conLock('advisor-lock-token-malo');
  try {
    crearLock(root, { pid: process.pid, host: hostname(), ts: Date.now(), version: 1, token: 'tok-ajeno' });
    eq(mod.releaseLock({ token: 'tok-equivocado' }), { released: true, reason: 'owner' }, 'libera por owner');
  } finally {
    cleanup([root]);
  }
});

test('release --force libera un lock ajeno (razon forced)', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-force');
  const dueno = { pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'tok-ajeno' };
  try {
    crearLock(root, dueno);
    const r = mod.releaseLock({ force: true });
    eq(r.released, true, 'liberado');
    eq(r.reason, 'forced', 'motivo forced');
    eq(r.owner, dueno, 'informa del owner forzado');
    assert(!existsSync(lockDir), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

test('owner.json corrupto: sin --force se NIEGA (no se puede comprobar token ni pid)', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-corrupto');
  try {
    crearLock(root, '{esto no es json');
    eq(mod.releaseLock(), { released: false, reason: 'corrupt-owner', owner: null }, 'cualquier llamante NO puede liberar un lock sin dueño legible');
    assert(existsSync(lockDir), 'el lock sigue en pie');
    eq(readFileSync(join(lockDir, 'owner.json'), 'utf8'), '{esto no es json', 'owner.json intacto');
    // La unica ruta documentada: --force.
    eq(mod.releaseLock({ force: true }), { released: true, reason: 'corrupt-owner' }, 'con --force sí lo libera');
    assert(!existsSync(lockDir), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

test('sin owner.json: sin --force se NIEGA, con --force libera (no-owner-file)', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-sin-owner');
  try {
    crearLock(root, undefined);
    eq(mod.releaseLock(), { released: false, reason: 'no-owner-file', owner: null }, 'no se libera a ciegas');
    assert(existsSync(lockDir), 'el lock sigue en pie');
    eq(mod.releaseLock({ token: 'cualquier-token' }), { released: false, reason: 'no-owner-file', owner: null }, 'tampoco un token inventado: no hay contra quien compararlo');
    assert(existsSync(lockDir), 'sigue en pie');
    eq(mod.releaseLock({ force: true }), { released: true, reason: 'no-owner-file' }, 'con --force sí lo libera');
    assert(!existsSync(lockDir), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

test('CLI release: lock sin dueño legible -> exit 1 con mensaje accionable, y --force lo libera', async () => {
  const root = sandbox('advisor-lock-cli-ownerless');
  try {
    crearLock(root, undefined);
    const re = cli(root, ['release']);
    eq(re.status, 1, 'exit 1 (mismo codigo que cualquier release denegado)');
    match(re.stderr, /release refused: no-owner-file/, 'motivo truthful');
    match(re.stderr, /--force/, 'el mensaje dice que hacer');
    assert(existsSync(join(root, LOCK)), 'el lock sigue en pie tras la negativa');
    const ok = cli(root, ['release', '--force']);
    eq(ok.status, 0, 'con --force, exit 0');
    eq(ok.stdout.trim(), 'lock released (no-owner-file)', 'mensaje de salida truthful');
    assert(!existsSync(join(root, LOCK)), 'dir borrado');
  } finally {
    cleanup([root]);
  }
});

// ── dirAgeMs / isStale ───────────────────────────────────────────────────────
suite('memory-lock dirAgeMs e isStale');

test('usa owner.ts cuando es un numero finito', async () => {
  const { root, mod } = await conLock('advisor-lock-edad');
  try {
    const dir = crearStale(root, 'a', BASE - 1000);
    eq(mod.dirAgeMs(dir, BASE + 5000), 6000, 'edad calculada desde owner.ts');
  } finally {
    cleanup([root]);
  }
});

test('sin owner.json cae al mtime del dir', async () => {
  const { root, mod } = await conLock('advisor-lock-edad-mtime');
  try {
    const dir = crearStale(root, 'sin-owner');
    const ahora = BASE + 5000;
    eq(mod.dirAgeMs(dir, ahora), ahora - statSync(dir).mtimeMs, 'edad = now - mtime del dir');
  } finally {
    cleanup([root]);
  }
});

test('owner.json corrupto o con ts no numerico cae al mtime del dir', async () => {
  const { root, mod } = await conLock('advisor-lock-edad-fallback');
  const ahora = BASE + 5000;
  try {
    for (const [nombre, contenido] of [
      ['corrupto', '{no-json'],
      ['ts-texto', '{"ts":"ayer"}'],
      ['ts-null', '{"ts":null}'],
      ['ts-ausente', '{}'],
    ]) {
      const dir = crearStale(root, nombre);
      writeFileSync(join(dir, 'owner.json'), contenido);
      eq(mod.dirAgeMs(dir, ahora), ahora - statSync(dir).mtimeMs, `${nombre}: fallback a mtime`);
    }
  } finally {
    cleanup([root]);
  }
});

test('un dir inexistente lanza ENOENT y isStale degrada a false', async () => {
  const { root, mod } = await conLock('advisor-lock-edad-enoent');
  try {
    const e = throws(() => mod.dirAgeMs(join(root, 'no-existe'), BASE), 'debe lanzar');
    eq(e.code, 'ENOENT', 'error del sistema de ficheros');
    eq(mod.isStale(), false, 'isStale captura el error y devuelve false');
    eq(mod.lockStatus().held, false, 'lockStatus tambien lo trata como libre');
  } finally {
    cleanup([root]);
  }
});

test('isStale: un lock recien creado no es stale y uno vencido si', async () => {
  const { root, mod } = await conLock('advisor-lock-isstale');
  try {
    crearLock(root, { pid: 1, host: 'otro', ts: Date.now(), version: 1, token: 'x' });
    eq(mod.isStale(), false, 'lock recien creado');
    crearLock(root, { pid: 1, host: 'otro', ts: Date.now() - mod.LOCK_STALE_MS - 1000, version: 1, token: 'x' });
    eq(mod.isStale(), true, 'lock mas viejo que el umbral');
    crearLock(root, { pid: 1, host: 'otro', ts: Date.now() - mod.LOCK_STALE_MS + 5000, version: 1, token: 'x' });
    eq(mod.isStale(), false, 'edad por debajo del umbral (comparacion estricta)');
  } finally {
    cleanup([root]);
  }
});

// ── lockStatus ──────────────────────────────────────────────────────────────
suite('memory-lock lockStatus');

test('sin lock: held false, staleDirs 0 y sin path', async () => {
  const { mod, root } = await conLock('advisor-lock-status-libre');
  try {
    eq(mod.lockStatus(), { held: false, staleDirs: 0 }, 'estado libre');
  } finally {
    cleanup([root]);
  }
});

test('con lock fresco: held true, stale false, ageMs, owner y path', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-status-fresco');
  try {
    const dueno = { pid: 4242, host: 'otro-host', ts: Date.now() - 1000, version: 1, token: 't' };
    crearLock(root, dueno);
    const s = mod.lockStatus();
    eq(s.held, true, 'tomado');
    eq(s.stale, false, 'no stale');
    eq(s.owner, dueno, 'owner leido del disco');
    eq(s.path, lockDir, 'path del lock');
    eq(s.staleDirs, 0, 'sin dirs stale');
    assert(typeof s.ageMs === 'number' && s.ageMs >= 1000, `ageMs en torno a la edad real (${s.ageMs})`);
  } finally {
    cleanup([root]);
  }
});

test('con lock vencido: stale true', async () => {
  const { root, mod } = await conLock('advisor-lock-status-stale');
  try {
    crearLock(root, { pid: 4242, host: 'otro-host', ts: Date.now() - 600000, version: 1, token: 't' });
    const s = mod.lockStatus();
    eq(s.held, true, 'tomado');
    eq(s.stale, true, 'stale por edad');
    assert(s.ageMs >= 600000, 'ageMs refleja la antigüedad');
  } finally {
    cleanup([root]);
  }
});

test('con owner corrupto: owner null y stale false (edad por mtime)', async () => {
  const { root, mod } = await conLock('advisor-lock-status-corrupto');
  try {
    crearLock(root, 'no-json');
    const s = mod.lockStatus();
    eq(s.held, true, 'el dir sigue tomado');
    eq(s.owner, null, 'owner ilegible');
    eq(s.stale, false, 'recien creado -> no stale');
    assert(typeof s.ageMs === 'number', 'ageMs disponible por mtime');
  } finally {
    cleanup([root]);
  }
});

test('cuenta los dirs .memory-lock.stale.* presentes', async () => {
  const { root, mod } = await conLock('advisor-lock-status-staledirs');
  try {
    crearStale(root, '111');
    crearStale(root, '222');
    crearLock(root, { pid: 1, host: 'otro', ts: Date.now(), version: 1, token: 't' });
    eq(mod.listStaleDirs().sort(), [`${STALE_PREFIX}111`, `${STALE_PREFIX}222`], 'lista de dirs stale');
    eq(mod.lockStatus().staleDirs, 2, 'status los cuenta');
  } finally {
    cleanup([root]);
  }
});

test('listStaleDirs filtra por prefijo y tolera una raiz ausente', async () => {
  const { root, mod } = await conLock('advisor-lock-status-filtro');
  try {
    crearStale(root, 'ok');
    crearLock(root, { pid: 1, host: 'otro', ts: Date.now(), version: 1, token: 't' });
    writeFileSync(join(root, 'notas.md'), 'x\n');
    eq(mod.listStaleDirs(), [`${STALE_PREFIX}ok`], 'solo los que empiezan por el prefijo');
    rmSync(root, { recursive: true, force: true });
    eq(mod.listStaleDirs(), [], 'raiz ausente -> lista vacia, sin lanzar');
    eq(mod.gcStaleDirs(), 0, 'GC sobre raiz ausente no lanza');
  } finally {
    cleanup([root]);
  }
});

// ── Takeover de un lock stale ────────────────────────────────────────────────
suite('memory-lock takeover');

test('takeover de un lock stale: renombra a .memory-lock.stale.<pid> y adquiere', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-takeover');
  const viejo = { pid: 4242424, host: 'otro-host', ts: Date.now() - 600000, version: 1, token: 'tok-viejo' };
  try {
    crearLock(root, viejo);
    const r = mod.acquireLock();
    eq(r.acquired, true, 'adquiere tras el takeover');
    match(r.token, /^[0-9a-f]{32}$/, 'token nuevo');
    neq(r.token, viejo.token, 'no reutiliza el token del dueno viejo');
    assert(existsSync(lockDir), 'el lock vuelve a su sitio canonico');
    assert(existsSync(join(root, `${STALE_PREFIX}${process.pid}`)), 'el dir viejo queda aside con el pid');
    eq(leerOwnerJson(lockDir), r.owner, 'owner.json nuevo escrito');
    eq(leerOwnerJson(join(root, `${STALE_PREFIX}${process.pid}`)), viejo, 'el owner viejo sigue en el dir aside');
    eq(readdirSync(root).length, 2, 'raiz con lock vivo + dir stale');
  } finally {
    cleanup([root]);
  }
});

test('el dir tomado no lo borra el GC todavia (esta recien)', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-takeover-gc');
  try {
    crearLock(root, { pid: 4242424, host: 'otro-host', ts: Date.now() - 600000, version: 1, token: 'viejo' });
    eq(mod.acquireLock().acquired, true, 'adquirido');
    eq(mod.lockStatus().staleDirs, 1, 'el dir aside se reporta');
    eq(mod.releaseLock(), { released: true, reason: 'owner' }, 'liberado');
    assert(existsSync(join(root, `${STALE_PREFIX}${process.pid}`)), 'el GC no borra un dir tan nuevo');
    assert(!existsSync(lockDir), 'no reabre el lock liberado');
  } finally {
    cleanup([root]);
  }
});

test('si el destino .memory-lock.stale.<pid> ya existe se le anade sufijo', async () => {
  const { root, mod } = await conLock('advisor-lock-takeover-colision');
  try {
    // Destino ocupado por un takeover previo reciente (el GC lo respeta).
    crearStale(root, String(process.pid), Date.now());
    crearLock(root, { pid: 4242424, host: 'otro-host', ts: Date.now() - 600000, version: 1, token: 'viejo' });
    eq(mod.acquireLock().acquired, true, 'adquirido pese a la colision de destino');
    eq(mod.listStaleDirs().sort(), [`${STALE_PREFIX}${process.pid}`, `${STALE_PREFIX}${process.pid}.1`], 'segundo destino con sufijo .1');
    mod.releaseLock();
  } finally {
    cleanup([root]);
  }
});

test('un lock fresco no se toca: la revalidacion pre-rename devuelve busy', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-takeover-fresco');
  try {
    crearLock(root, { pid: 4242424, host: 'otro-host', ts: Date.now(), version: 1, token: 'fresco' });
    eq(mod.takeoverStale(), { taken: false, reason: 'busy' }, 'sin tocar nada');
    assert(existsSync(lockDir), 'el lock sigue en su sitio');
    eq(mod.listStaleDirs(), [], 'no se creo ningun dir stale');
    assert(existsSync(join(lockDir, 'owner.json')), 'el owner intacto');
  } finally {
    cleanup([root]);
  }
});

test('carrera perdida: si el lock desaparece en la revalidacion, acquire devuelve busy sin owner', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-carrera');
  try {
    crearLock(root, { pid: 1, host: 'otro', ts: BASE + 5000, version: 1, token: 'viejo' });
    // Lecturas de reloj de acquireLock: 0 = GC, 1 = isStale, 2 = revalidacion de
    // takeover (el lock se lleva justo despues), 3+ = edad del dir movido.
    const r = withFakeNow([BASE + 10 * HORA, BASE + 10 * HORA, () => {
      rmSync(lockDir, { recursive: true, force: true });
      return BASE + 10 * HORA;
    }], () => mod.acquireLock());
    eq(r.acquired, false, 'no adquiere');
    eq(r.reason, 'busy', 'se reporta busy (otro proceso gano la carrera)');
    eq(r.owner, null, 'sin owner: el lock ya no existe');
    assert(!existsSync(lockDir), 'no queda un lock a medias');
    eq(mod.acquireLock().acquired, true, 'el siguiente acquire si puede');
  } finally {
    cleanup([root]);
  }
});

test('si el owner movido sale fresco se restaura y se reporta busy', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-restore');
  const dueno = { pid: 1, host: 'otro', ts: BASE + 5000, version: 1, token: 'fresco' };
  try {
    crearLock(root, dueno);
    // 1a lectura de reloj (pre-rename): muy advanced -> stale. 2a (post-rename):
    // el owner movido parece fresco -> restauracion.
    const r = withFakeNow([BASE + 10 * HORA, BASE], () => mod.takeoverStale());
    eq(r.taken, false, 'no se toma posesion de un lock fresco');
    eq(r.reason, 'busy', 'motivo busy');
    eq(r.owner, dueno, 'informa del owner fresco');
    assert(!existsSync(join(root, `${STALE_PREFIX}${process.pid}`)), 'el dir movido volvio a su sitio');
    eq(leerOwnerJson(lockDir), dueno, 'el lock restaurado es el original');
  } finally {
    cleanup([root]);
  }
});

test('si la restauracion falla se loggea a stderr y se marca restoreFailed', async () => {
  const { root, mod } = await conLock('advisor-lock-restore-fail');
  const dueno = { pid: 1, host: 'otro', ts: BASE + 5000, version: 1, token: 'fresco' };
  try {
    crearLock(root, dueno);
    // Al leer el reloj post-rename, otro proceso ocupa ya `.memory-lock`: el
    // rename de restauracion no puede reemplazar un dir no vacio.
    const { resultado, stderr } = withFakeNow(
      [BASE + 10 * HORA, () => {
        mkdirSync(join(root, LOCK), { recursive: true });
        writeFileSync(join(root, LOCK, 'impostor.txt'), 'otro proceso\n');
        return BASE;
      }],
      () => capturandoStderr(() => mod.takeoverStale()),
    );
    eq(resultado.taken, false, 'no se toma posesion');
    eq(resultado.reason, 'busy', 'motivo busy');
    eq(resultado.restoreFailed, true, 'la restauracion fallida es visible');
    eq(resultado.owner, dueno, 'informa del owner fresco');
    eq(stderr, ['memory-lock: restore failed; a fresh lock could not be restored'], 'aviso exacto en stderr');
    assert(existsSync(join(root, `${STALE_PREFIX}${process.pid}`)), 'el dir movido se queda sin restaurar');
    eq(readdirSync(join(root, LOCK)), ['impostor.txt'], 'el impostor conserva la posesion');
  } finally {
    cleanup([root]);
  }
});

test('acquireLock propaga restoreFailed en su resultado busy', async () => {
  const { root, mod } = await conLock('advisor-lock-restore-acquire');
  const dueno = { pid: 1, host: 'otro', ts: BASE + 5000, version: 1, token: 'fresco' };
  try {
    crearLock(root, dueno);
    // Lecturas de reloj de acquireLock: 0 = GC, 1 = isStale, 2 = revalidacion,
    // 3 = edad del dir movido (justo aqui aparece el impostor).
    const { resultado, stderr } = withFakeNow(
      [BASE + 10 * HORA, BASE + 10 * HORA, BASE + 10 * HORA, () => {
        mkdirSync(join(root, LOCK), { recursive: true });
        writeFileSync(join(root, LOCK, 'impostor.txt'), 'otro proceso\n');
        return BASE;
      }],
      () => capturandoStderr(() => mod.acquireLock()),
    );
    eq(resultado.acquired, false, 'no adquirido');
    eq(resultado.reason, 'busy', 'motivo busy');
    eq(resultado.restoreFailed, true, 'restoreFailed visible tambien desde acquire');
    eq(resultado.owner, dueno, 'informa del owner fresco');
    eq(stderr.length, 1, 'un unico aviso en stderr');
  } finally {
    cleanup([root]);
  }
});

test('un lock stale sin owner.json tambien es tomado por su mtime', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-takeover-sin-owner');
  try {
    crearLock(root, undefined);
    const pasado = new Date(Date.now() - 600000);
    utimesSync(lockDir, pasado, pasado); // mtime viejo: stale sin owner.json
    eq(mod.acquireLock().acquired, true, 'tomado usando la edad del dir');
    eq(mod.releaseLock(), { released: true, reason: 'owner' }, 'liberado');
  } finally {
    cleanup([root]);
  }
});

// ── GC de dirs stale ────────────────────────────────────────────────────────
suite('memory-lock GC');

test('gcStaleDirs borra solo los dirs stale por encima del umbral (suelo de 1h)', async () => {
  const { root, mod } = await conLock('advisor-lock-gc');
  try {
    const antiguo = crearStale(root, 'antiguo', BASE); // 2 h de edad
    const reciente = crearStale(root, 'reciente', BASE + 2 * HORA - 30 * 60000); // 30 min
    eq(mod.gcStaleDirs(BASE + 2 * HORA), 1, 'borra solo el antiguo');
    assert(!existsSync(antiguo), 'el antiguo desaparece');
    assert(existsSync(reciente), 'el reciente se conserva');
  } finally {
    cleanup([root]);
  }
});

test('gc sin parametro usa el reloj real y mide por mtime si no hay owner.json', async () => {
  const { root, mod } = await conLock('advisor-lock-gc-mtime');
  try {
    const viejo = crearStale(root, 'viejo'); // sin owner.json -> mtime
    const nuevo = crearStale(root, 'nuevo');
    const hace2h = new Date(Date.now() - 2 * HORA);
    utimesSync(viejo, hace2h, hace2h);
    eq(mod.gcStaleDirs(), 1, 'borra el dir con mtime de hace 2 h');
    assert(!existsSync(viejo), 'el viejo desaparece');
    assert(existsSync(nuevo), 'el nuevo se conserva');
  } finally {
    cleanup([root]);
  }
});

test('gc nunca toca el lock vivo ni los ficheros normales de la raiz', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-gc-vivo');
  try {
    crearLock(root, { pid: 1, host: 'otro', ts: Date.now(), version: 1, token: 't' });
    writeFileSync(join(root, 'notas.md'), 'x\n');
    const antiguo = crearStale(root, 'antiguo', Date.now() - 2 * HORA);
    eq(mod.gcStaleDirs(), 1, 'solo el dir stale antiguo');
    assert(existsSync(lockDir), 'el lock vivo intacto');
    assert(existsSync(join(root, 'notas.md')), 'los ficheros de la raiz intactos');
    assert(!existsSync(antiguo), 'el dir stale antiguo eliminado');
  } finally {
    cleanup([root]);
  }
});

test('acquire ejecuta el GC y deja el lock vivo en su sitio', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-gc-acquire');
  try {
    const huerfano = crearStale(root, 'huerfano', Date.now() - 2 * HORA);
    eq(mod.acquireLock().acquired, true, 'adquirido tras el GC');
    assert(!existsSync(huerfano), 'el dir huerfano se limpio al adquirir');
    assert(existsSync(lockDir), 'el lock nuevo existe');
    eq(mod.lockStatus().staleDirs, 0, 'no quedan dirs stale');
  } finally {
    cleanup([root]);
  }
});

test('release tambien ejecuta el GC y deja la raiz limpia', async () => {
  const { root, mod, lockDir } = await conLock('advisor-lock-gc-release');
  try {
    eq(mod.acquireLock().acquired, true, 'adquirido');
    const huerfano = crearStale(root, 'huerfano', Date.now() - 2 * HORA);
    eq(mod.releaseLock(), { released: true, reason: 'owner' }, 'liberado');
    assert(!existsSync(huerfano), 'el GC de release limpio el huerfano');
    assert(!existsSync(lockDir), 'el lock liberado');
    eq(readdirSync(root), [], 'el sandbox queda vacio');
  } finally {
    cleanup([root]);
  }
});

// ── Aislamiento ─────────────────────────────────────────────────────────────
suite('memory-lock aislamiento');

test('el ciclo acquire/release no deja escombros en el sandbox', async () => {
  const { root, mod } = await conLock('advisor-lock-debris');
  try {
    for (let i = 0; i < 3; i++) {
      eq(mod.acquireLock().acquired, true, `adquisicion ${i + 1}`);
      eq(mod.lockStatus().held, true, `status tomado en la vuelta ${i + 1}`);
      eq(mod.releaseLock(), { released: true, reason: 'owner' }, `liberacion ${i + 1}`);
    }
    eq(readdirSync(root), [], 'el sandbox queda completamente vacio');
    eq(mod.lockStatus(), { held: false, staleDirs: 0 }, 'estado final libre');
  } finally {
    cleanup([root]);
  }
});

test('ningun sandbox de la suite conserva un lock y el repo nunca fue destino', async () => {
  const { root, mod } = await conLock('advisor-lock-final');
  try {
    // 1) Todos los sandboxes que aun existen (los ya limpiados no cuentan) se
    //    comprueban ahora mismo: ninguno debe conservar un lock.
    const vivos = sandboxes.filter((p) => existsSync(p));
    for (const p of vivos) {
      eq(readdirSync(p).filter((n) => n.startsWith(LOCK)), [], `${p} no conserva ${LOCK}*`);
    }
    // 2) Este sandbox nuevo tampoco: acquire+release y no queda nada.
    eq(mod.acquireLock().acquired, true, 'adquirido');
    eq(mod.releaseLock().released, true, 'liberado');
    eq(readdirSync(root), [], 'nada queda tras el ciclo');
    // 3) La instancia usada resuelve el lock dentro del sandbox, no en el repo.
    assert(mod.lockPath().startsWith(root), 'el lock se resuelve dentro del sandbox');
    neq(mod.lockPath(), join(REPO_RAIZ, LOCK), 'nunca en la raiz del repo');
  } finally {
    cleanup([root, ...sandboxes.filter((p) => existsSync(p))]);
    sandboxes.length = 0;
  }
});

await runAll();
